import { $, esc, icon, loadConfig, loadGames, isPublished, initChrome, coverHTML, byline, playUrl, fmtDate, isNew } from './common.js';

const grid = $('#grid');
const chips = $('#chips');
const count = $('#count');
const q = $('#q');
const sort = $('#sort');

let games = [];
let activeTag = '';

drawHeroBoard();
showSkeleton();
init();

async function init() {
  const cfg = await loadConfig();
  initChrome(cfg);
  try {
    games = (await loadGames()).filter(isPublished);
  } catch (e) {
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = `<div class="empty-state">${icon('triangle-alert')}<h3>暫時載入不到遊戲</h3><p>請檢查網絡，然後重新整理頁面。</p><button class="btn" type="button" onclick="location.reload()">${icon('refresh-cw')}重新整理</button></div>`;
    return;
  }
  renderChips();
  render();
  q.addEventListener('input', render);
  sort.addEventListener('change', render);
}

function showSkeleton() {
  grid.innerHTML = Array.from({ length: 4 }, () => `
    <div class="game-card" aria-hidden="true">
      <div class="cover skeleton" style="border-radius:0"></div>
      <div class="game-card-body">
        <div class="skeleton skeleton-line" style="width:70%;height:1.3em"></div>
        <div class="skeleton skeleton-line" style="width:45%"></div>
        <div class="skeleton skeleton-line" style="width:90%"></div>
      </div>
    </div>`).join('');
}

function renderChips() {
  const counts = new Map();
  games.forEach((g) => (g.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const tags = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'zh-Hant'));
  if (tags.length < 2) { chips.hidden = true; return; }
  chips.innerHTML = [`<button type="button" class="chip" data-tag="" aria-pressed="true">全部</button>`]
    .concat(tags.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}</button>`)).join('');
  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activeTag = btn.dataset.tag;
    chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
    render();
  });
}

function render() {
  const term = q.value.trim().toLowerCase();
  let list = games.filter((g) => {
    if (activeTag && !(g.tags || []).includes(activeTag)) return false;
    if (!term) return true;
    return [g.title, g.author, g.klass, g.desc, (g.tags || []).join(' ')].some((v) => String(v || '').toLowerCase().includes(term));
  });
  const by = sort.value;
  list = list.slice().sort((a, b) => {
    if (by === 'name') return String(a.title).localeCompare(String(b.title), 'zh-Hant');
    const d = Date.parse(b.created || 0) - Date.parse(a.created || 0);
    return by === 'old' ? -d : d;
  });

  grid.setAttribute('aria-busy', 'false');
  count.textContent = games.length ? (list.length === games.length ? `共 ${games.length} 個` : `${list.length} / ${games.length} 個`) : '';

  if (!games.length) {
    grid.innerHTML = `<div class="empty-state">${icon('gamepad-2')}<h3>遊戲館還是空的</h3><p>成為第一個上傳遊戲的同學，讓全班試玩你的作品。</p><a class="btn btn-primary" href="upload.html">${icon('upload')}上傳第一個遊戲</a></div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">${icon('search')}<h3>找不到符合的遊戲</h3><p>試試其他關鍵字，或者清除篩選條件。</p><button class="btn" type="button" id="clearFilter">${icon('rotate-ccw')}顯示全部遊戲</button></div>`;
    $('#clearFilter').addEventListener('click', () => {
      q.value = '';
      activeTag = '';
      chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.tag === '')));
      render();
    });
    return;
  }

  grid.innerHTML = list.map((g) => `
    <a class="game-card" href="${esc(playUrl(g))}">
      <div style="position:relative">
        ${coverHTML(g)}
        ${isNew(g) ? '<span class="badge-new">新</span>' : ''}
      </div>
      <div class="game-card-body">
        <h3>${esc(g.title)}</h3>
        <p class="by">${esc(byline(g))}</p>
        ${g.desc ? `<p class="desc">${esc(g.desc)}</p>` : ''}
        <div class="meta">
          ${(g.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
          <span class="date">${esc(fmtDate(g.created))}</span>
        </div>
      </div>
    </a>`).join('');
}

// 首頁插圖：座標平面上的五子棋
function drawHeroBoard() {
  const el = $('#heroBoard');
  if (!el) return;
  const S = 360, M = 34, R = 4, C = (S - M * 2) / (R * 2);
  const X = (x) => M + (x + R) * C;
  const Y = (y) => M + (R - y) * C;
  let s = `<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  for (let i = -R; i <= R; i++) {
    if (i === 0) continue;
    s += `<line x1="${X(i)}" y1="${Y(R)}" x2="${X(i)}" y2="${Y(-R)}" stroke="#2748a0" stroke-opacity=".22"/>`;
    s += `<line x1="${X(-R)}" y1="${Y(i)}" x2="${X(R)}" y2="${Y(i)}" stroke="#2748a0" stroke-opacity=".22"/>`;
  }
  // 座標軸
  s += `<g stroke="#1c2331" stroke-width="2.2" stroke-linecap="round" fill="none">
    <line x1="${X(-R) - 10}" y1="${Y(0)}" x2="${X(R) + 16}" y2="${Y(0)}"/>
    <line x1="${X(0)}" y1="${Y(-R) + 10}" x2="${X(0)}" y2="${Y(R) - 16}"/>
    <polyline points="${X(R) + 9},${Y(0) - 5} ${X(R) + 17},${Y(0)} ${X(R) + 9},${Y(0) + 5}"/>
    <polyline points="${X(0) - 5},${Y(R) - 9} ${X(0)},${Y(R) - 17} ${X(0) + 5},${Y(R) - 9}"/>
  </g>`;
  s += `<g font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="15" fill="#1c2331">
    <text x="${X(R) + 12}" y="${Y(0) + 20}" text-anchor="middle">x</text>
    <text x="${X(0) + 14}" y="${Y(R) - 12}" text-anchor="middle">y</text></g>`;
  s += `<g font-family="Helvetica, Arial, sans-serif" font-size="10.5" font-weight="600" fill="#556074">`;
  for (let i = -R; i <= R; i++) {
    if (i === 0) continue;
    const t = i < 0 ? '−' + -i : i;
    s += `<text x="${X(i)}" y="${Y(0) + 15}" text-anchor="middle">${t}</text>`;
    s += `<text x="${X(0) - 7}" y="${Y(i) + 4}" text-anchor="end">${t}</text>`;
  }
  s += `</g>`;
  // 讀座標的虛線
  s += `<g stroke="#c8391f" stroke-width="1.6" stroke-dasharray="4 4" fill="none">
    <line x1="${X(1)}" y1="${Y(2)}" x2="${X(1)}" y2="${Y(0)}"/><line x1="${X(1)}" y1="${Y(2)}" x2="${X(0)}" y2="${Y(2)}"/></g>`;
  const stones = [
    [-3, -2, 'b'], [-2, 1, 'w'], [-2, -1, 'b'], [-1, -2, 'w'], [-1, 0, 'b'],
    [2, -1, 'w'], [0, 1, 'b'], [3, -2, 'w'], [1, 2, 'b']
  ];
  s += `<defs>
    <radialGradient id="gb" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#606778"/><stop offset=".7" stop-color="#141922"/></radialGradient>
    <radialGradient id="gw" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d9d4c5"/></radialGradient>
  </defs>`;
  stones.forEach(([x, y, c], i) => {
    s += `<circle class="pop" style="animation-delay:${200 + i * 140}ms" cx="${X(x)}" cy="${Y(y)}" r="${C * 0.42}" fill="url(#g${c})" stroke="#1c2331" stroke-width="${c === 'w' ? 1.2 : 0}"/>`;
  });
  // 座標標籤
  const lx = X(1) + 16, ly = Y(2) - 30;
  s += `<g class="pop" style="animation-delay:${200 + stones.length * 140 + 100}ms">
    <rect x="${lx}" y="${ly}" width="64" height="28" rx="14" fill="#c8391f"/>
    <text x="${lx + 32}" y="${ly + 19}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#fff">(1, 2)</text></g>`;
  s += `</svg>`;
  el.innerHTML = s;
}
