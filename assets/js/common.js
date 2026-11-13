// 各頁共用的小工具：設定、遊戲清單、圖示、封面。

export const GAMES_PATH = 'games.json';
export const CONFIG_PATH = 'config.json';

export const DEFAULT_TAGS = ['數學', '中文', '英文', '科學', '人文', '益智', '棋類', '動作', '問答', '其他'];

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-${name}"></use></svg>`;
}

// ---------- 設定 ----------

export async function loadConfig() {
  let cfg = {};
  try {
    const res = await fetch(CONFIG_PATH + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) cfg = await res.json();
  } catch (e) { /* 使用預設值 */ }

  // 在 GitHub Pages 上，直接由網址得知擁有者和儲存庫（複製本站到另一帳戶也不用改設定）
  const host = location.hostname;
  if (/\.github\.io$/i.test(host)) {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    cfg.owner = host.split('.')[0];
    cfg.repo = seg && !/\.html?$/i.test(seg) ? seg : host;
  }
  cfg.branch = cfg.branch || 'main';
  cfg.siteName = cfg.siteName || 'AI 遊戲館';
  cfg.tags = Array.isArray(cfg.tags) && cfg.tags.length ? cfg.tags : DEFAULT_TAGS;
  cfg.uploadOpen = cfg.uploadOpen !== false;
  cfg.requireApproval = cfg.requireApproval === true;
  cfg.configured = !!(cfg.studentKey && cfg.studentKey.ct && cfg.owner && cfg.repo);
  return cfg;
}

// 只保留可以寫回 config.json 的欄位
export function serializeConfig(cfg) {
  const out = {
    siteName: cfg.siteName,
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    uploadOpen: cfg.uploadOpen,
    requireApproval: cfg.requireApproval,
    tags: cfg.tags,
    studentKey: cfg.studentKey || null,
    teacherKey: cfg.teacherKey || null
  };
  return JSON.stringify(out, null, 2) + '\n';
}

// ---------- 遊戲清單 ----------

export async function loadGames() {
  const res = await fetch(GAMES_PATH + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('無法載入遊戲清單');
  const data = await res.json();
  return Array.isArray(data.games) ? data.games : [];
}

export function isPublished(game) {
  return !game.status || game.status === 'published';
}

export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function gameUrl(game) {
  return `games/${encodeURIComponent(game.id)}/${encodePath(game.entry || 'index.html')}`;
}

export function playUrl(game) {
  return `play.html?id=${encodeURIComponent(game.id)}`;
}

export function makeId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate());
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  return date + '-' + rnd;
}

// ---------- 顯示 ----------

const dateFmt = new Intl.DateTimeFormat('zh-Hant-HK', { year: 'numeric', month: 'long', day: 'numeric' });
export function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : dateFmt.format(d);
}

export function isNew(game, days = 7) {
  const t = Date.parse(game.created);
  return !isNaN(t) && Date.now() - t < days * 86400000;
}

function hashHue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

// 遊戲封面：有上傳圖片就用圖片，否則用遊戲名稱第一個字做一張方格紙封面
export function coverHTML(game, { coverUrl } = {}) {
  const title = (game.title || '遊戲').trim();
  const first = Array.from(title)[0] || '遊';
  const gen = `<div class="cover-gen" style="--h:${hashHue(title)}" aria-hidden="true"><span>${esc(first)}</span></div>`;
  const src = coverUrl || (game.cover ? `games/${encodeURIComponent(game.id)}/${encodePath(game.cover)}` : '');
  if (!src) return `<div class="cover">${gen}</div>`;
  return `<div class="cover">${gen}<img src="${esc(src)}" alt="" loading="lazy" decoding="async" style="position:absolute;inset:0" onerror="this.remove()"></div>`;
}

export function byline(game) {
  return [game.klass, game.author].filter(Boolean).join(' ');
}

// 頁首頁尾的共用處理
export function initChrome(cfg) {
  $$('[data-site-name]').forEach((el) => { el.textContent = cfg.siteName; });
  const repoLink = $('[data-repo-link]');
  if (repoLink && cfg.owner && cfg.repo) repoLink.href = `https://github.com/${cfg.owner}/${cfg.repo}`;
  const year = $('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

// 按下「複製」後短暫顯示「已複製」
export function flashCopied(btn, ok = true) {
  const orig = btn.dataset.orig || btn.innerHTML;
  btn.dataset.orig = orig;
  btn.innerHTML = ok ? icon('check') + '已複製' : '請手動複製';
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.innerHTML = orig; }, 1800);
}

export function qrSvg(text) {
  if (!window.qrcode) return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
