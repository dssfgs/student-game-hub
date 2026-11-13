import { $, $$, esc, icon, loadConfig, initChrome, coverHTML, byline, makeId, playUrl, gameUrl, GAMES_PATH } from './common.js';
import { decryptSecret } from './crypto.js';
import { GitHub, bytesToB64 } from './github.js';
import {
  LIMITS, COVER_NAME, fmtBytes, isHtml, extOf, fromFileList, fromDataTransfer, expandZips, normalize,
  autoRenameSingleHtml, entryCandidates, checkReferences, buildPreviewHtml, cleanPastedCode, looksLikeHtml, makeCover
} from './files.js';

const state = {
  cfg: null,
  mode: 'files',      // 'files' | 'paste'
  picked: [],         // 同學選擇的原始檔案 [{path, blob}]
  files: [],          // 整理後準備上傳的檔案 [{path, blob, size, sha?}]
  errors: [],
  entry: null,
  cover: null,        // Blob
  coverUrl: null,
  info: null,
  uploading: false,
  refreshToken: 0
};

const el = {
  notice: $('#notice'), wizard: $('#wizard'), steps: $('#steps'),
  tabFiles: $('#tabFiles'), tabPaste: $('#tabPaste'), paneFiles: $('#paneFiles'), panePaste: $('#panePaste'),
  drop: $('#drop'), pickFiles: $('#pickFiles'), pickDir: $('#pickDir'), fileInput: $('#fileInput'), dirInput: $('#dirInput'),
  code: $('#code'), summary: $('#summary'), summaryTitle: $('#summaryTitle'), fileList: $('#fileList'), clearFiles: $('#clearFiles'),
  entryField: $('#entryField'), entry: $('#entry'), problems: $('#problems'), previewBtn: $('#previewBtn'), next1: $('#next1'),
  infoForm: $('#infoForm'), title: $('#title'), author: $('#author'), klass: $('#klass'), desc: $('#desc'), tool: $('#tool'),
  tagChips: $('#tagChips'), coverPreview: $('#coverPreview'), pickCover: $('#pickCover'), removeCover: $('#removeCover'),
  coverInput: $('#coverInput'), coverErr: $('#coverErr'),
  review: $('#review'), uploadForm: $('#uploadForm'), password: $('#password'), togglePw: $('#togglePw'), pwErr: $('#pwErr'),
  uploadBtn: $('#uploadBtn'), confirmView: $('#confirmView'), progressView: $('#progressView'), successView: $('#successView'),
  bar: $('#bar'), pFilesText: $('#pFilesText'), uploadError: $('#uploadError'),
  successTitle: $('#successTitle'), successText: $('#successText'), liveStatus: $('#liveStatus'), playLink: $('#playLink'),
  previewDialog: $('#previewDialog'), previewFrame: $('#previewFrame'), closePreview: $('#closePreview')
};

init();

async function init() {
  const cfg = state.cfg = await loadConfig();
  initChrome(cfg);

  if (!cfg.configured) {
    el.notice.innerHTML = `<div class="empty-state">${icon('settings')}<h2>老師還未開通上傳功能</h2><p>請通知老師到「老師管理」完成一次設定，之後同學就可以在這裡上傳遊戲。</p><a class="btn" href="admin.html">${icon('lock')}前往老師管理</a></div>`;
    return;
  }
  if (!cfg.uploadOpen) {
    el.notice.innerHTML = `<div class="empty-state">${icon('lock')}<h2>上傳暫時關閉</h2><p>老師暫停了上傳功能。你可以先到大廳試玩其他同學的遊戲。</p><a class="btn" href="index.html">${icon('gamepad-2')}回到遊戲大廳</a></div>`;
    return;
  }
  el.wizard.hidden = false;

  // 觸控裝置（例如 iPad）不能選擇資料夾
  const canPickDir = 'webkitdirectory' in HTMLInputElement.prototype && window.matchMedia('(any-pointer: fine)').matches;
  if (!canPickDir) el.pickDir.hidden = true;

  el.tagChips.innerHTML = cfg.tags.map((t) => `<label class="chip"><input type="checkbox" name="tags" value="${esc(t)}" />${esc(t)}</label>`).join('');
  renderCoverPreview();
  bind();
}

// ====================== 步驟一：選擇檔案 ======================

function bind() {
  el.tabFiles.addEventListener('click', () => setMode('files'));
  el.tabPaste.addEventListener('click', () => setMode('paste'));

  el.pickFiles.addEventListener('click', () => el.fileInput.click());
  el.pickDir.addEventListener('click', () => el.dirInput.click());
  el.fileInput.addEventListener('change', () => { addItems(fromFileList(el.fileInput.files)); el.fileInput.value = ''; });
  el.dirInput.addEventListener('change', () => { addItems(fromFileList(el.dirInput.files)); el.dirInput.value = ''; });

  ['dragenter', 'dragover'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('is-over'); }));
  ['dragleave', 'dragend'].forEach((t) => el.drop.addEventListener(t, () => el.drop.classList.remove('is-over')));
  el.drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.drop.classList.remove('is-over');
    try {
      addItems(await fromDataTransfer(e.dataTransfer));
    } catch (err) {
      showProblems([{ type: 'error', html: '讀取拖放的檔案時出錯，請改用「選擇檔案」。' }]);
    }
  });
  // 避免不小心把檔案拖到頁面其他位置時，瀏覽器直接打開檔案
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  let pasteTimer;
  el.code.addEventListener('input', () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(refresh, 250); });

  el.clearFiles.addEventListener('click', () => {
    if (state.mode === 'paste') el.code.value = '';
    else state.picked = [];
    refresh();
  });
  el.fileList.addEventListener('click', (e) => {
    const btn = e.target.closest('.rm');
    if (!btn) return;
    const f = state.files[Number(btn.dataset.i)];
    if (!f) return;
    state.picked = state.picked.filter((p) => p.blob !== f.blob);
    refresh();
  });
  el.entry.addEventListener('change', () => { state.entry = el.entry.value; renderFileList(); });

  el.previewBtn.addEventListener('click', openPreview);
  el.closePreview.addEventListener('click', () => el.previewDialog.close());
  el.previewDialog.addEventListener('close', () => { el.previewFrame.srcdoc = ''; });
  el.previewDialog.addEventListener('click', (e) => { if (e.target === el.previewDialog) el.previewDialog.close(); });

  el.next1.addEventListener('click', () => showStep(2));

  // 步驟二
  el.tagChips.addEventListener('change', () => {
    const boxes = $$('input', el.tagChips);
    const full = boxes.filter((b) => b.checked).length >= 3;
    boxes.forEach((b) => {
      b.disabled = full && !b.checked;
      b.parentElement.classList.toggle('is-on', b.checked);
    });
  });
  el.title.addEventListener('input', renderCoverPreview);
  el.pickCover.addEventListener('click', () => el.coverInput.click());
  el.coverInput.addEventListener('change', onCoverPicked);
  el.removeCover.addEventListener('click', () => { setCover(null); });
  $('#back2').addEventListener('click', () => showStep(1));
  el.infoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (validateInfo()) showStep(3);
  });

  // 步驟三
  $('#back3').addEventListener('click', () => showStep(2));
  el.togglePw.addEventListener('click', () => {
    const show = el.password.type === 'password';
    el.password.type = show ? 'text' : 'password';
    el.togglePw.setAttribute('aria-pressed', String(show));
    el.togglePw.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
    el.togglePw.innerHTML = icon(show ? 'eye-off' : 'eye');
  });
  el.uploadForm.addEventListener('submit', (e) => { e.preventDefault(); startUpload(); });

  window.addEventListener('beforeunload', (e) => {
    if (state.uploading) { e.preventDefault(); e.returnValue = ''; }
  });
}

function setMode(mode) {
  state.mode = mode;
  el.tabFiles.setAttribute('aria-selected', String(mode === 'files'));
  el.tabPaste.setAttribute('aria-selected', String(mode === 'paste'));
  el.paneFiles.hidden = mode !== 'files';
  el.panePaste.hidden = mode !== 'paste';
  refresh();
  if (mode === 'paste') el.code.focus();
}

async function addItems(items) {
  if (!items.length) return;
  try {
    const expanded = await expandZips(items);
    state.picked.push(...expanded);
  } catch (err) {
    showProblems([{ type: 'error', html: esc(err.message || '讀取檔案時出錯。') }]);
    return;
  }
  refresh();
}

// 重新整理、檢查目前選擇的檔案，並更新畫面
async function refresh() {
  const token = ++state.refreshToken;
  const notes = [];
  let result;

  if (state.mode === 'paste') {
    const text = cleanPastedCode(el.code.value);
    if (!text) {
      result = { files: [], rejected: [], errors: [], total: 0 };
    } else {
      const blob = new Blob([text], { type: 'text/html' });
      result = { files: [{ path: 'index.html', blob, size: blob.size }], rejected: [], errors: [], total: blob.size };
      if (!looksLikeHtml(text)) result.errors.push('這段文字看來不是 HTML 程式碼。請向 AI 索取「完整的 HTML 檔案」，再整段複製貼上。');
      else if (blob.size > LIMITS.maxFileBytes) result.errors.push('程式碼太長，超過 ' + fmtBytes(LIMITS.maxFileBytes) + '。');
    }
  } else {
    result = normalize(state.picked);
    const renamed = autoRenameSingleHtml(result.files);
    if (renamed) notes.push({ type: 'info', html: `已自動把「${esc(renamed)}」改名為 <code>index.html</code>，方便其他人打開。` });
  }

  const candidates = entryCandidates(result.files);
  if (!candidates.includes(state.entry)) state.entry = candidates[0] || null;

  let refs = [];
  if (result.files.length && !result.errors.length) {
    try { refs = await checkReferences(result.files); } catch (e) { refs = []; }
  }
  if (token !== state.refreshToken) return; // 期間又有新的更改

  state.files = result.files;
  state.errors = result.errors;

  result.errors.forEach((m) => notes.push({ type: 'error', html: esc(m) }));
  if (result.rejected.length) {
    notes.push({ type: 'warn', html: `以下 ${result.rejected.length} 個檔案不會上傳：<ul>${result.rejected.slice(0, 8).map((r) => `<li><code>${esc(r.path)}</code>（${esc(r.reason)}）</li>`).join('')}${result.rejected.length > 8 ? '<li>……</li>' : ''}</ul>` });
  }
  const missing = refs.filter((r) => r.kind === 'missing');
  const local = refs.filter((r) => r.kind === 'local');
  const wrongCase = refs.filter((r) => r.kind === 'case');
  if (missing.length) {
    notes.push({ type: 'warn', html: `<strong>可能漏了檔案。</strong>遊戲需要以下檔案，但你沒有選擇：<ul>${missing.slice(0, 8).map((r) => `<li><code>${esc(r.ref)}</code>（<code>${esc(r.html)}</code> 需要）</li>`).join('')}</ul>請把它們一併加入，否則遊戲可能無法運作。${state.mode === 'paste' ? '如果遊戲有多個檔案，請改用「上傳檔案」。' : ''}` });
  }
  if (wrongCase.length) {
    notes.push({ type: 'warn', html: `<strong>檔案名稱的大小寫不一致。</strong>上傳後網站會找不到這些檔案：<ul>${wrongCase.slice(0, 8).map((r) => `<li>程式碼寫的是 <code>${esc(r.ref)}</code>，實際檔案是 <code>${esc(r.actual)}</code></li>`).join('')}</ul>請把檔案名稱改成完全一樣。` });
  }
  if (local.length) {
    notes.push({ type: 'warn', html: `<strong>遊戲使用了你電腦內的路徑。</strong>其他人打開時會看不到這些檔案：<ul>${local.slice(0, 5).map((r) => `<li><code>${esc(r.ref)}</code></li>`).join('')}</ul>請叫 AI 改用「相對路徑」（例如 <code>images/cat.png</code>），並把檔案一併上傳。` });
  }
  if (result.files.length && !notes.some((n) => n.type !== 'info')) {
    notes.push({ type: 'ok', html: '檔案檢查完成，沒有發現問題。' });
  }

  renderFileList(candidates);
  showProblems(notes);

  const ready = state.files.length > 0 && !state.errors.length && !!state.entry;
  el.next1.disabled = !ready;
  el.previewBtn.disabled = !ready;
}

function renderFileList(candidates) {
  const files = state.files;
  const has = files.length > 0;
  el.summary.hidden = !has;
  const filesMode = state.mode === 'files';
  el.drop.classList.toggle('compact', has && filesMode);
  el.pickFiles.innerHTML = icon(has ? 'plus' : 'file-code') + (has ? '加入更多檔案' : '選擇檔案');
  el.pickDir.innerHTML = icon('folder-up') + (has ? '加入資料夾' : '選擇資料夾');
  if (!has) return;

  const total = files.reduce((s, f) => s + f.size, 0);
  el.summaryTitle.textContent = `已準備 ${files.length} 個檔案，共 ${fmtBytes(total)}`;
  el.fileList.innerHTML = files.map((f, i) => `
    <li>
      ${icon(isHtml(f.path) ? 'file-code' : /^(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/.test(extOf(f.path)) ? 'image' : 'file')}
      <span class="path">${esc(f.path)}</span>
      ${f.path === state.entry ? '<span class="tag ok">主頁</span>' : ''}
      <span class="size">${fmtBytes(f.size)}</span>
      ${filesMode ? `<button type="button" class="rm" data-i="${i}" aria-label="移除 ${esc(f.path)}">${icon('x')}</button>` : ''}
    </li>`).join('');

  if (candidates) {
    el.entryField.hidden = candidates.length < 2;
    el.entry.innerHTML = candidates.map((c) => `<option value="${esc(c)}"${c === state.entry ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }
}

function showProblems(notes) {
  const iconFor = { error: 'circle-alert', warn: 'triangle-alert', ok: 'circle-check', info: 'info' };
  el.problems.innerHTML = notes.map((n) => `<div class="note ${n.type === 'info' ? '' : n.type}">${icon(iconFor[n.type])}<div>${n.html}</div></div>`).join('');
}

async function openPreview() {
  try {
    el.previewFrame.srcdoc = await buildPreviewHtml(state.files, state.entry);
    el.previewDialog.showModal();
  } catch (err) {
    showProblems([{ type: 'error', html: '無法預覽這個遊戲：' + esc(err.message) }]);
  }
}

// ====================== 步驟切換 ======================

function showStep(n) {
  [1, 2, 3].forEach((i) => { $('#step' + i).hidden = i !== n; });
  $$('li', el.steps).forEach((li) => {
    const i = Number(li.dataset.step);
    li.classList.toggle('done', i < n);
    if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  if (n === 3) renderReview();
  el.steps.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const first = n === 2 ? el.title : n === 3 ? el.password : null;
  if (first) first.focus({ preventScroll: true });
}

function markAllDone() {
  $$('li', el.steps).forEach((li) => { li.classList.add('done'); li.removeAttribute('aria-current'); });
}

// ====================== 步驟二：遊戲資料 ======================

function clean(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function readInfo() {
  return {
    title: clean(el.title.value, 30),
    author: clean(el.author.value, 20),
    klass: clean(el.klass.value, 10),
    desc: String(el.desc.value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200),
    tool: clean(el.tool.value, 30),
    tags: $$('input:checked', el.tagChips).map((b) => b.value).slice(0, 3)
  };
}

function validateInfo() {
  const info = readInfo();
  const tErr = info.title ? '' : '請輸入遊戲名稱。';
  const aErr = info.author ? '' : '請輸入作者（可以用暱稱）。';
  $('#titleErr').textContent = tErr;
  $('#authorErr').textContent = aErr;
  el.title.setAttribute('aria-invalid', String(!!tErr));
  el.author.setAttribute('aria-invalid', String(!!aErr));
  if (tErr) el.title.focus(); else if (aErr) el.author.focus();
  state.info = info;
  return !tErr && !aErr;
}

async function onCoverPicked() {
  const file = el.coverInput.files[0];
  el.coverInput.value = '';
  if (!file) return;
  el.coverErr.textContent = '';
  try {
    setCover(await makeCover(file));
  } catch (err) {
    el.coverErr.textContent = err.message;
  }
}

function setCover(blob) {
  if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
  state.cover = blob;
  state.coverUrl = blob ? URL.createObjectURL(blob) : null;
  el.removeCover.hidden = !blob;
  el.pickCover.innerHTML = icon('image') + (blob ? '更換圖片' : '選擇圖片');
  renderCoverPreview();
}

function renderCoverPreview() {
  el.coverPreview.innerHTML = coverHTML({ title: clean(el.title.value, 30) || '遊戲' }, { coverUrl: state.coverUrl });
}

// ====================== 步驟三：上傳 ======================

function renderReview() {
  const info = state.info || readInfo();
  const total = state.files.reduce((s, f) => s + f.size, 0);
  el.review.innerHTML = `
    ${coverHTML({ title: info.title }, { coverUrl: state.coverUrl })}
    <div>
      <h3>${esc(info.title)}</h3>
      <p>${esc(byline(info))}</p>
      <p>${state.files.length} 個檔案・${fmtBytes(total)}・主頁 ${esc(state.entry)}</p>
      ${info.tags.length ? `<div class="tag-row">${info.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  showView('confirm');
}

function showView(name) {
  el.confirmView.hidden = name !== 'confirm';
  el.progressView.hidden = name !== 'progress';
  el.successView.hidden = name !== 'success';
}

function setProgress(key, status) {
  const li = $(`[data-p="${key}"]`, el.progressView);
  li.classList.remove('active', 'done', 'fail');
  if (status) li.classList.add(status);
}

function setBar(pct) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  el.bar.setAttribute('aria-valuenow', String(v));
  el.bar.firstElementChild.style.width = v + '%';
}

async function startUpload() {
  if (state.uploading) return;
  const password = el.password.value;
  el.pwErr.textContent = '';
  if (!password.trim()) {
    el.pwErr.textContent = '請輸入老師提供的上傳密碼。';
    el.password.focus();
    return;
  }

  state.uploading = true;
  el.uploadBtn.disabled = true;
  el.uploadError.innerHTML = '';
  ['auth', 'files', 'commit'].forEach((k) => setProgress(k, null));
  el.pFilesText.textContent = '上傳遊戲檔案';
  setBar(2);
  showView('progress');
  let stage = 'auth';

  try {
    // 1. 用密碼解開權杖
    setProgress('auth', 'active');
    let token;
    try {
      token = await decryptSecret(state.cfg.studentKey, password);
    } catch (err) {
      state.uploading = false;
      el.uploadBtn.disabled = false;
      showView('confirm');
      el.pwErr.textContent = '密碼不正確，請再輸入一次。留意英文大小寫。';
      el.password.focus();
      el.password.select();
      return;
    }
    const gh = new GitHub({ owner: state.cfg.owner, repo: state.cfg.repo, branch: state.cfg.branch, token });
    setProgress('auth', 'done');
    setBar(6);

    // 2. 逐個上傳檔案
    stage = 'files';
    setProgress('files', 'active');
    const uploads = state.files.map((f) => ({ file: f, path: f.path }));
    if (state.cover) uploads.push({ file: { blob: state.cover, size: state.cover.size, coverRef: true }, path: COVER_NAME });
    const totalBytes = uploads.reduce((s, u) => s + u.file.size, 0) || 1;
    let doneBytes = 0, doneCount = 0;
    const tick = () => {
      el.pFilesText.textContent = `上傳遊戲檔案（${doneCount} / ${uploads.length}）`;
      setBar(6 + (doneBytes / totalBytes) * 80);
    };
    tick();
    const queue = uploads.slice();
    const worker = async () => {
      while (queue.length) {
        const u = queue.shift();
        if (!u.file.sha) {
          const bytes = new Uint8Array(await u.file.blob.arrayBuffer());
          u.file.sha = await gh.createBlob(bytesToB64(bytes));
        }
        doneBytes += u.file.size;
        doneCount++;
        tick();
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, uploads.length) }, worker));
    setProgress('files', 'done');

    // 3. 一次過寫入儲存庫，並更新遊戲清單
    stage = 'commit';
    setProgress('commit', 'active');
    setBar(90);
    const info = state.info;
    const game = {
      id: makeId(),
      title: info.title,
      author: info.author,
      klass: info.klass,
      desc: info.desc,
      tags: info.tags,
      tool: info.tool,
      entry: state.entry,
      cover: state.cover ? COVER_NAME : null,
      files: state.files.length,
      bytes: state.files.reduce((s, f) => s + f.size, 0),
      created: new Date().toISOString(),
      status: state.cfg.requireApproval ? 'pending' : 'published'
    };
    await gh.commit(async (head) => {
      const data = await gh.readJson(GAMES_PATH, head.commitSha, { version: 1, games: [] });
      if (!Array.isArray(data.games)) data.games = [];
      while (data.games.some((g) => g.id === game.id)) game.id = makeId();
      data.games.unshift(game);
      data.updated = new Date().toISOString();
      const entries = uploads.map((u) => ({ path: `games/${game.id}/${u.path}`, sha: u.file.sha }));
      entries.push({ path: GAMES_PATH, content: JSON.stringify(data, null, 2) + '\n' });
      return { message: `新增遊戲：${game.title}（${byline(game)}）`, entries };
    });
    setProgress('commit', 'done');
    setBar(100);

    state.uploading = false;
    onSuccess(game);
  } catch (err) {
    state.uploading = false;
    el.uploadBtn.disabled = false;
    setProgress(stage, 'fail');
    console.error(err);
    el.uploadError.innerHTML = `
      <div class="note error">${icon('circle-alert')}<div><strong>上傳未能完成。</strong>${esc(err.message || '發生未知的錯誤。')}</div></div>
      <div class="panel-actions"><button class="btn" type="button" id="backToConfirm">${icon('arrow-left')}返回</button><div class="right"><button class="btn btn-primary" type="button" id="retryUpload">${icon('refresh-cw')}再試一次</button></div></div>`;
    $('#backToConfirm').addEventListener('click', () => showView('confirm'));
    $('#retryUpload').addEventListener('click', startUpload);
  }
}

function onSuccess(game) {
  markAllDone();
  showView('success');
  el.password.value = '';
  el.successTitle.focus();

  if (game.status === 'pending') {
    el.successTitle.textContent = '已經提交！';
    el.successText.textContent = `「${game.title}」已交給老師審核，通過後就會在遊戲大廳出現。`;
    el.liveStatus.hidden = true;
    el.playLink.hidden = true;
    return;
  }

  el.successText.textContent = `「${game.title}」已經存進遊戲館。`;
  el.liveStatus.innerHTML = icon('loader-circle', 'spin') + '<span>正在上線，通常需要大約 1 分鐘…</span>';
  el.playLink.href = playUrl(game);
  waitUntilLive(game);
}

// GitHub Pages 需要一點時間重新發佈，這裡每隔幾秒檢查一次
async function waitUntilLive(game) {
  const started = Date.now();
  const check = async () => {
    try {
      const res = await fetch(GAMES_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if ((data.games || []).some((g) => g.id === game.id)) {
          const page = await fetch(gameUrl(game) + '?t=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
          if (page.ok) return true;
        }
      }
    } catch (e) { /* 再試 */ }
    return false;
  };
  while (Date.now() - started < 5 * 60 * 1000) {
    if (await check()) {
      el.liveStatus.classList.add('ok');
      el.liveStatus.innerHTML = icon('circle-check') + '<span>已經上線，可以玩了！</span>';
      el.playLink.setAttribute('aria-disabled', 'false');
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  el.liveStatus.innerHTML = icon('info') + '<span>上線時間比平常長，請稍後到遊戲大廳查看。</span>';
  el.playLink.setAttribute('aria-disabled', 'false');
}

el.playLink.addEventListener('click', (e) => {
  if (el.playLink.getAttribute('aria-disabled') === 'true') e.preventDefault();
});
