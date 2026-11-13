import { $, esc, icon, loadConfig, loadGames, isPublished, initChrome, byline, gameUrl, fmtDate, copyText, flashCopied, qrSvg } from './common.js';

init();

async function init() {
  const cfg = await loadConfig();
  initChrome(cfg);
  const id = new URLSearchParams(location.search).get('id') || '';
  let game = null;
  let failed = false;
  try {
    game = (await loadGames()).find((g) => g.id === id) || null;
  } catch (e) {
    failed = true;
  }
  $('#loading').hidden = true;

  if (!game || !isPublished(game)) {
    const waiting = game && game.status === 'pending';
    $('#missing').hidden = false;
    $('#missing').innerHTML = `
      <div class="empty-state" style="margin-top: var(--space-10)">
        ${icon(waiting ? 'shield-check' : 'gamepad-2')}
        <h1 style="font-size: var(--text-lg); margin-bottom: var(--space-2)">${waiting ? '這個遊戲正在等待老師審核' : failed ? '暫時載入不到遊戲' : '找不到這個遊戲'}</h1>
        <p>${waiting ? '老師通過審核後，就可以在這裡遊玩。' : failed ? '請檢查網絡，然後重新整理頁面。' : '遊戲可能已被移除。如果是剛剛上傳的，請等大約 1 分鐘再重新整理。'}</p>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-3);justify-content:center">
          <button class="btn" type="button" onclick="location.reload()">${icon('refresh-cw')}重新整理</button>
          <a class="btn btn-primary" href="index.html">${icon('house')}回到遊戲大廳</a>
        </div>
      </div>`;
    return;
  }

  document.title = `${game.title}｜${cfg.siteName}`;
  $('#gTitle').textContent = game.title;
  $('#gBy').textContent = byline(game);
  $('#gDesc').textContent = game.desc || '作者沒有填寫玩法簡介，直接試玩看看吧。';
  $('#gTags').innerHTML = (game.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const meta = [['上傳日期', fmtDate(game.created)]];
  if (game.tool) meta.push(['使用的 AI', game.tool]);
  $('#gMeta').innerHTML = meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  const src = gameUrl(game);
  const frame = $('#frame');
  frame.src = src;
  frame.title = game.title;
  $('#openBtn').href = src;
  $('#game').hidden = false;

  // 全螢幕（iPhone 不支援時改為開新分頁）
  const stage = $('#stage');
  const fsBtn = $('#fsBtn');
  const request = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (!request) fsBtn.hidden = true;
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const p = request.call(stage);
      if (p && p.catch) p.catch(() => window.open(src, '_blank', 'noopener'));
    }
  });

  // 分享
  const dialog = $('#shareDialog');
  const url = location.href.split('#')[0];
  $('#shareBtn').addEventListener('click', () => {
    $('#shareUrl').value = url;
    $('#qr').innerHTML = qrSvg(url);
    dialog.showModal();
  });
  $('#closeShare').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('#shareUrl').addEventListener('focus', (e) => e.target.select());
  $('#copyBtn').addEventListener('click', async (e) => flashCopied(e.currentTarget, await copyText(url)));
}
