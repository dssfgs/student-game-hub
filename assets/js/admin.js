import {
  $, $$, esc, icon, loadConfig, serializeConfig, initChrome, coverHTML, byline, gameUrl, fmtDate,
  copyText, flashCopied, qrSvg, GAMES_PATH, CONFIG_PATH
} from './common.js';
import { encryptSecret, decryptSecret, normalizePassword } from './crypto.js';
import { GitHub } from './github.js';
import { fmtBytes } from './files.js';

const MIN_STUDENT = 8;
const MIN_TEACHER = 10;

const state = { cfg: null, token: null, gh: null, games: [], verifiedToken: null, setupMode: 'first', busy: false };

const el = {
  fatal: $('#fatal'), setup: $('#setup'), login: $('#login'), dash: $('#dash'), dashMsg: $('#dashMsg'),
  setupTitle: $('#setupTitle'), repoName: $('#repoName'), tokenLink: $('#tokenLink'),
  tokenForm: $('#tokenForm'), token: $('#token'), verifyBtn: $('#verifyBtn'), tokenStatus: $('#tokenStatus'),
  pwForm: $('#pwForm'), studentPw: $('#studentPw'), teacherPw: $('#teacherPw'), finishSetup: $('#finishSetup'),
  cancelSetup: $('#cancelSetup'), setupError: $('#setupError'),
  loginForm: $('#loginForm'), loginPw: $('#loginPw'), loginErr: $('#loginErr'), loginBtn: $('#loginBtn'),
  adminList: $('#adminList'), gamesCount: $('#gamesCount'),
  swOpen: $('#swOpen'), swApprove: $('#swApprove'), siteName: $('#siteName'),
  confirmDialog: $('#confirmDialog'), confirmText: $('#confirmText'), confirmOk: $('#confirmOk')
};

init();

async function init() {
  const cfg = state.cfg = await loadConfig();
  initChrome(cfg);
  if (!cfg.owner || !cfg.repo) {
    el.fatal.innerHTML = `<div class="note error">${icon('circle-alert')}<div>找不到 GitHub 儲存庫的資料。請在 <code>config.json</code> 填寫 <code>owner</code> 和 <code>repo</code>。</div></div>`;
    return;
  }
  el.repoName.textContent = `${cfg.owner}/${cfg.repo}`;
  const params = new URLSearchParams({
    name: (cfg.repo + '-upload').slice(0, 40),
    description: '讓學生經遊戲館網站上傳遊戲（只限 ' + cfg.owner + '/' + cfg.repo + '）',
    target_name: cfg.owner,
    expires_in: '366',
    contents: 'write'
  });
  el.tokenLink.href = 'https://github.com/settings/personal-access-tokens/new?' + params.toString();

  bind();
  if (cfg.teacherKey && cfg.teacherKey.ct) show('login'); else openSetup('first');
}

function show(name) {
  el.setup.hidden = name !== 'setup';
  el.login.hidden = name !== 'login';
  el.dash.hidden = name !== 'dash';
  if (name === 'login') el.loginPw.focus();
}

function note(type, html) {
  const icons = { ok: 'circle-check', error: 'circle-alert', warn: 'triangle-alert', info: 'info' };
  return `<div class="note ${type === 'info' ? '' : type}" style="margin-bottom: var(--space-5)">${icon(icons[type])}<div>${html}</div></div>`;
}

function setBusy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = icon('loader-circle', 'spin') + (label || '處理中…');
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

function newGh(token) {
  return new GitHub({ owner: state.cfg.owner, repo: state.cfg.repo, branch: state.cfg.branch, token });
}

// 讀取儲存庫內最新的 config.json，套用更改後寫回
async function writeConfig(gh, message, mutate) {
  let saved = null;
  await gh.commit(async (head) => {
    const remote = await gh.readJson(CONFIG_PATH, head.commitSha, {});
    const merged = Object.assign({}, state.cfg, remote, { owner: state.cfg.owner, repo: state.cfg.repo, branch: state.cfg.branch });
    merged.tags = Array.isArray(remote.tags) && remote.tags.length ? remote.tags : state.cfg.tags;
    merged.siteName = remote.siteName || state.cfg.siteName;
    merged.uploadOpen = remote.uploadOpen !== false;
    merged.requireApproval = remote.requireApproval === true;
    mutate(merged);
    saved = merged;
    return { message, entries: [{ path: CONFIG_PATH, content: serializeConfig(merged) }] };
  });
  Object.assign(state.cfg, saved);
  return saved;
}

// ====================== 設定權杖 ======================

function openSetup(mode) {
  state.setupMode = mode;
  state.verifiedToken = null;
  el.setupTitle.textContent = mode === 'first' ? '第一次設定' : '更換權杖';
  el.cancelSetup.hidden = mode === 'first';
  el.token.value = '';
  el.studentPw.value = '';
  el.teacherPw.value = '';
  el.tokenStatus.textContent = '';
  el.tokenStatus.className = 'inline-status';
  el.setupError.innerHTML = '';
  el.finishSetup.disabled = true;
  show('setup');
}

async function verifyToken(e) {
  e.preventDefault();
  const token = el.token.value.trim();
  state.verifiedToken = null;
  el.finishSetup.disabled = true;
  const fail = (msg) => {
    el.tokenStatus.className = 'inline-status err';
    el.tokenStatus.innerHTML = icon('circle-alert') + esc(msg);
  };
  if (!token) return fail('請先貼上權杖。');
  if (/\s/.test(token)) return fail('權杖中間不應有空格，請重新複製。');
  setBusy(el.verifyBtn, true, '檢查中…');
  try {
    const gh = newGh(token);
    try {
      await gh.verify();
    } catch (err) {
      if (err.status === 401) return fail('GitHub 不接受這個權杖，請確認已完整複製。');
      if (err.status === 404) return fail(`這個權杖不能存取 ${state.cfg.owner}/${state.cfg.repo}。請在 Repository access 選擇這個儲存庫。`);
      return fail(err.message);
    }
    try {
      await gh.createBlob(btoa('write-check'));
    } catch (err) {
      if (err.status === 403 || err.status === 404) return fail('這個權杖只能讀取，不能寫入。請把 Contents 權限設為 Read and write。');
      return fail(err.message);
    }
    state.verifiedToken = token;
    el.tokenStatus.className = 'inline-status ok';
    el.tokenStatus.innerHTML = icon('circle-check') + `權杖有效，可以寫入 ${esc(state.cfg.owner)}/${esc(state.cfg.repo)}。`;
    el.finishSetup.disabled = false;
    el.studentPw.focus();
  } finally {
    setBusy(el.verifyBtn, false);
  }
}

function checkPasswords(student, teacher) {
  let sErr = '', tErr = '';
  if (student !== null) {
    if (normalizePassword(student).length < MIN_STUDENT) sErr = `最少要 ${MIN_STUDENT} 個字元。`;
  }
  if (teacher !== null) {
    if (normalizePassword(teacher).length < MIN_TEACHER) tErr = `最少要 ${MIN_TEACHER} 個字元。`;
    else if (student !== null && normalizePassword(student) === normalizePassword(teacher)) tErr = '老師密碼不可以和學生密碼相同。';
  }
  return { sErr, tErr };
}

async function finishSetup(e) {
  e.preventDefault();
  if (!state.verifiedToken) return;
  const { sErr, tErr } = checkPasswords(el.studentPw.value, el.teacherPw.value);
  $('#studentPwErr').textContent = sErr;
  $('#teacherPwErr').textContent = tErr;
  if (sErr) return el.studentPw.focus();
  if (tErr) return el.teacherPw.focus();

  el.setupError.innerHTML = '';
  setBusy(el.finishSetup, true, '正在加密和儲存…');
  try {
    const token = state.verifiedToken;
    const [studentKey, teacherKey] = await Promise.all([
      encryptSecret(token, el.studentPw.value),
      encryptSecret(token, el.teacherPw.value)
    ]);
    const gh = newGh(token);
    await writeConfig(gh, state.setupMode === 'first' ? '設定遊戲館上傳功能' : '更換遊戲館上傳權杖', (c) => {
      c.studentKey = studentKey;
      c.teacherKey = teacherKey;
    });
    const studentPw = normalizePassword(el.studentPw.value);
    await enter(token);
    el.dashMsg.innerHTML = note('ok', `<strong>設定完成。</strong>學生上傳密碼是 <code>${esc(studentPw)}</code>，請告訴同學。大約 1 分鐘後，上傳頁就可以使用。`);
  } catch (err) {
    el.setupError.innerHTML = note('error', '儲存設定時出錯：' + esc(err.message));
  } finally {
    setBusy(el.finishSetup, false);
  }
}

// ====================== 登入 ======================

async function login(e) {
  e.preventDefault();
  el.loginErr.textContent = '';
  const pw = el.loginPw.value;
  if (!pw.trim()) { el.loginErr.textContent = '請輸入老師管理密碼。'; return; }
  setBusy(el.loginBtn, true, '登入中…');
  try {
    let token;
    try {
      token = await decryptSecret(state.cfg.teacherKey, pw);
    } catch (err) {
      el.loginErr.textContent = '密碼不正確。';
      el.loginPw.select();
      return;
    }
    try {
      await enter(token);
      el.loginPw.value = '';
    } catch (err) {
      if (err.status === 401) {
        openSetup('replace');
        el.setupError.innerHTML = note('warn', 'GitHub 權杖已經過期或被刪除。請建立新權杖，並重新設定密碼。');
      } else {
        el.loginErr.textContent = err.message;
      }
    }
  } finally {
    setBusy(el.loginBtn, false);
  }
}

async function enter(token) {
  const gh = newGh(token);
  const games = await fetchGames(gh);
  state.token = token;
  state.gh = gh;
  state.games = games;
  el.dashMsg.innerHTML = '';
  renderDash();
  show('dash');
}

async function fetchGames(gh) {
  const head = await gh.getHead();
  const data = await gh.readJson(GAMES_PATH, head.commitSha, { version: 1, games: [] });
  return Array.isArray(data.games) ? data.games : [];
}

// ====================== 管理介面 ======================

function renderDash() {
  const cfg = state.cfg;
  el.swOpen.checked = cfg.uploadOpen;
  el.swApprove.checked = cfg.requireApproval;
  el.siteName.value = cfg.siteName;
  const siteUrl = new URL('./', location.href).href;
  $('#siteUrl').value = siteUrl;
  $('#siteQr').innerHTML = qrSvg(siteUrl);
  renderGames();
}

function renderGames() {
  const games = state.games;
  const pending = games.filter((g) => g.status === 'pending').length;
  el.gamesCount.textContent = `共 ${games.length} 個` + (pending ? `，${pending} 個待審核` : '');
  if (!games.length) {
    el.adminList.innerHTML = `<li class="empty-state" style="max-width:none">${icon('gamepad-2')}<h3>還沒有遊戲</h3><p>同學上傳後，遊戲會在這裡出現。</p></li>`;
    return;
  }
  const order = { pending: 0, published: 1, hidden: 2 };
  const sorted = games.slice().sort((a, b) => (order[a.status || 'published'] - order[b.status || 'published']) || (Date.parse(b.created || 0) - Date.parse(a.created || 0)));
  el.adminList.innerHTML = sorted.map((g) => {
    const st = g.status || 'published';
    const badge = st === 'pending' ? '<span class="tag warn">待審核</span>' : st === 'hidden' ? '<span class="tag neutral">已隱藏</span>' : '<span class="tag ok">公開</span>';
    const toggle = st === 'pending' ? `<button class="btn btn-sm btn-primary" type="button" data-op="publish">${icon('check')}批准</button>`
      : st === 'hidden' ? `<button class="btn btn-sm" type="button" data-op="publish">${icon('eye')}重新顯示</button>`
      : `<button class="btn btn-sm" type="button" data-op="hide">${icon('eye-off')}隱藏</button>`;
    return `
      <li class="admin-item" data-id="${esc(g.id)}">
        ${coverHTML(g)}
        <div>
          <h3>${esc(g.title)} ${badge}</h3>
          <p>${esc(byline(g))}・${esc(fmtDate(g.created))}・${g.files || '?'} 個檔案${g.bytes ? '・' + fmtBytes(g.bytes) : ''}</p>
        </div>
        <div class="ops">
          <a class="btn btn-sm" href="${esc(gameUrl(g))}" target="_blank" rel="noopener noreferrer">${icon('play')}試玩</a>
          ${toggle}
          <button class="btn btn-sm btn-danger" type="button" data-op="delete">${icon('trash-2')}刪除</button>
        </div>
      </li>`;
  }).join('');
}

async function runOp(label, fn, okMsg) {
  if (state.busy) return;
  state.busy = true;
  $$('button, input', el.dash).forEach((b) => { b.disabled = true; });
  el.dashMsg.innerHTML = note('info', icon('loader-circle', 'spin') + ' ' + esc(label));
  try {
    await fn();
    el.dashMsg.innerHTML = note('ok', okMsg);
  } catch (err) {
    console.error(err);
    el.dashMsg.innerHTML = note('error', '操作未能完成：' + esc(err.message));
  } finally {
    state.busy = false;
    $$('button, input', el.dash).forEach((b) => { b.disabled = false; });
    $('#siteUrl').disabled = false;
    renderDash();
    el.dashMsg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// 更改 games.json（並可同時刪除檔案）
async function updateGames(message, mutate, extraEntries) {
  let result = null;
  await state.gh.commit(async (head) => {
    const data = await state.gh.readJson(GAMES_PATH, head.commitSha, { version: 1, games: [] });
    if (!Array.isArray(data.games)) data.games = [];
    mutate(data);
    data.updated = new Date().toISOString();
    result = data.games;
    const entries = [{ path: GAMES_PATH, content: JSON.stringify(data, null, 2) + '\n' }];
    if (extraEntries) entries.push(...(await extraEntries(head)));
    return { message, entries };
  });
  state.games = result;
}

function setStatus(id, status) {
  const g = state.games.find((x) => x.id === id);
  if (!g) return;
  const verb = status === 'hidden' ? '隱藏' : g.status === 'pending' ? '批准' : '重新顯示';
  runOp(`正在${verb}「${g.title}」…`, () => updateGames(`${verb}遊戲：${g.title}`, (data) => {
    const t = data.games.find((x) => x.id === id);
    if (t) t.status = status;
  }), `已${verb}「${esc(g.title)}」。大約 1 分鐘後在網站生效。`);
}

function askDelete(id) {
  const g = state.games.find((x) => x.id === id);
  if (!g) return;
  el.confirmText.textContent = `確定要刪除「${g.title}」（${byline(g)}）嗎？遊戲的所有檔案會從儲存庫移除。`;
  el.confirmOk.onclick = () => {
    el.confirmDialog.close();
    runOp(`正在刪除「${g.title}」…`, () => updateGames(`刪除遊戲：${g.title}`, (data) => {
      data.games = data.games.filter((x) => x.id !== id);
    }, async (head) => {
      const paths = await state.gh.listTree(head.treeSha, `games/${id}/`);
      return paths.map((p) => ({ path: p, remove: true }));
    }), `已刪除「${esc(g.title)}」。`);
  };
  el.confirmDialog.showModal();
}

function bind() {
  el.tokenForm.addEventListener('submit', verifyToken);
  el.token.addEventListener('input', () => { state.verifiedToken = null; el.finishSetup.disabled = true; el.tokenStatus.textContent = ''; });
  el.pwForm.addEventListener('submit', finishSetup);
  el.cancelSetup.addEventListener('click', () => show(state.token ? 'dash' : 'login'));
  el.loginForm.addEventListener('submit', login);
  $('#forgot').addEventListener('click', () => openSetup('replace'));
  $('#replaceToken').addEventListener('click', () => openSetup('replace'));

  el.adminList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-op]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    if (btn.dataset.op === 'delete') askDelete(id);
    else setStatus(id, btn.dataset.op === 'hide' ? 'hidden' : 'published');
  });
  $$('[data-close]', el.confirmDialog).forEach((b) => b.addEventListener('click', () => el.confirmDialog.close()));
  el.confirmDialog.addEventListener('click', (e) => { if (e.target === el.confirmDialog) el.confirmDialog.close(); });

  $('#reloadGames').addEventListener('click', () => runOp('正在重新載入…', async () => { state.games = await fetchGames(state.gh); }, '已載入最新的遊戲清單。'));

  el.swOpen.addEventListener('change', () => {
    const on = el.swOpen.checked;
    runOp('正在儲存設定…', () => writeConfig(state.gh, on ? '開放上傳' : '暫停上傳', (c) => { c.uploadOpen = on; }), on ? '已開放上傳。' : '已暫停上傳。');
  });
  el.swApprove.addEventListener('change', () => {
    const on = el.swApprove.checked;
    runOp('正在儲存設定…', () => writeConfig(state.gh, on ? '開啟上傳審核' : '關閉上傳審核', (c) => { c.requireApproval = on; }), on ? '已開啟審核：新遊戲需要你批准才會公開。' : '已關閉審核：新遊戲上傳後會直接公開。');
  });
  $('#nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.siteName.value.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!name) return el.siteName.focus();
    runOp('正在儲存網站名稱…', async () => { await writeConfig(state.gh, '更改網站名稱：' + name, (c) => { c.siteName = name; }); initChrome(state.cfg); }, '已更改網站名稱。');
  });

  $('#changeStudent').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#newStudentPw');
    const { sErr } = checkPasswords(input.value, null);
    $('#newStudentErr').textContent = sErr;
    if (sErr) return input.focus();
    const pw = normalizePassword(input.value);
    runOp('正在更改學生上傳密碼…', async () => {
      const box = await encryptSecret(state.token, pw);
      await writeConfig(state.gh, '更改學生上傳密碼', (c) => { c.studentKey = box; });
      input.value = '';
    }, `學生上傳密碼已改為 <code>${esc(pw)}</code>。大約 1 分鐘後生效。`);
  });
  $('#changeTeacher').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#newTeacherPw');
    const { tErr } = checkPasswords(null, input.value);
    $('#newTeacherErr').textContent = tErr;
    if (tErr) return input.focus();
    const pw = input.value;
    runOp('正在更改老師管理密碼…', async () => {
      const box = await encryptSecret(state.token, pw);
      await writeConfig(state.gh, '更改老師管理密碼', (c) => { c.teacherKey = box; });
      input.value = '';
    }, '老師管理密碼已更改。');
  });

  $('#siteUrl').addEventListener('focus', (e) => e.target.select());
  $('#copySite').addEventListener('click', async (e) => flashCopied(e.currentTarget, await copyText($('#siteUrl').value)));
}
