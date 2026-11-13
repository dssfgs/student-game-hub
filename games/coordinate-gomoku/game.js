/* 座標五子棋 — 在座標平面上落子，x、y 的範圍是 -7 至 7 */
(function () {
  'use strict';

  var R = 7;                 // 座標範圍：-R 至 R
  var N = R * 2 + 1;         // 每邊交叉點數目（15）
  var BLACK = 1, WHITE = 2;
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var wrap = canvas.parentElement;
  var hoverTip = document.getElementById('hover');
  var resultBox = document.getElementById('result');
  var resultTitle = document.getElementById('resultTitle');
  var resultLine = document.getElementById('resultLine');
  var resultCoords = document.getElementById('resultCoords');
  var turnStone = document.getElementById('turnStone');
  var turnText = document.getElementById('turnText');
  var movesList = document.getElementById('moves');
  var movesEmpty = document.getElementById('movesEmpty');
  var coordForm = document.getElementById('coordForm');
  var xInput = document.getElementById('xInput');
  var yInput = document.getElementById('yInput');
  var formMsg = document.getElementById('formMsg');
  var undoBtn = document.getElementById('undoBtn');
  var resetBtn = document.getElementById('resetBtn');
  var againBtn = document.getElementById('againBtn');

  var state = {
    grid: {},          // key "x,y" -> BLACK | WHITE
    moves: [],         // [{x, y, player}]
    player: BLACK,
    over: false,
    winLine: null,     // [{x, y}, ...]
    opponent: 'human', // 'human' | 'ai'
    input: 'click',    // 'click' | 'type'
    hover: null,       // {x, y}
    thinking: false
  };
  var aiTimer = null;
  var size = 0, margin = 0, cell = 0;

  /* ---------- 小工具 ---------- */
  function key(x, y) { return x + ',' + y; }
  function at(x, y) { return state.grid[key(x, y)] || 0; }
  function inRange(x, y) { return x >= -R && x <= R && y >= -R && y <= R; }
  function num(n) { return n < 0 ? '\u2212' + Math.abs(n) : String(n); }
  function coord(x, y) { return '(' + num(x) + ', ' + num(y) + ')'; }
  function playerName(p) { return p === BLACK ? '黑子' : '白子'; }

  function describe(x, y) {
    if (x === 0 && y === 0) return '原點';
    if (y === 0) return 'x 軸上';
    if (x === 0) return 'y 軸上';
    if (x > 0 && y > 0) return '第一象限';
    if (x < 0 && y > 0) return '第二象限';
    if (x < 0 && y < 0) return '第三象限';
    return '第四象限';
  }

  function lineEquation(line) {
    var a = line[0], b = line[1];
    var dx = b.x - a.x, dy = b.y - a.y;
    if (dy === 0) return '水平線　y = ' + num(a.y);
    if (dx === 0) return '鉛垂線　x = ' + num(a.x);
    var slope = dy / dx;
    var c = a.y - slope * a.x;
    var head = slope > 0 ? 'y = x' : 'y = \u2212x';
    if (c === 0) return '斜線　' + head;
    return '斜線　' + head + (c > 0 ? ' + ' : ' \u2212 ') + Math.abs(c);
  }

  /* ---------- 畫棋盤 ---------- */
  function px(x) { return margin + (x + R) * cell; }
  function py(y) { return margin + (R - y) * cell; }

  function resize() {
    var rect = wrap.getBoundingClientRect();
    var s = Math.max(200, Math.floor(Math.min(rect.width, rect.height || rect.width)));
    var dpr = window.devicePixelRatio || 1;
    size = s;
    canvas.width = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    margin = s * 0.075;
    cell = (s - margin * 2) / (N - 1);
    draw();
  }

  function draw() {
    var i, v;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, size, size);

    // 象限標示
    ctx.fillStyle = 'rgba(47, 85, 164, 0.13)';
    ctx.font = '800 ' + Math.round(cell * 1.5) + 'px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('I', px(4), py(4));
    ctx.fillText('II', px(-4), py(4));
    ctx.fillText('III', px(-4), py(-4));
    ctx.fillText('IV', px(4), py(-4));

    // 格線
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(47, 85, 164, 0.28)';
    ctx.beginPath();
    for (i = -R; i <= R; i++) {
      if (i === 0) continue;
      v = Math.round(px(i)) + 0.5;
      ctx.moveTo(v, py(R)); ctx.lineTo(v, py(-R));
      v = Math.round(py(i)) + 0.5;
      ctx.moveTo(px(-R), v); ctx.lineTo(px(R), v);
    }
    ctx.stroke();

    // 座標軸
    var ext = margin * 0.55;
    var ah = Math.max(5, cell * 0.24);
    ctx.strokeStyle = '#1c2331';
    ctx.fillStyle = '#1c2331';
    ctx.lineWidth = Math.max(1.6, cell * 0.06);
    ctx.beginPath();
    ctx.moveTo(px(-R) - ext * 0.5, py(0)); ctx.lineTo(px(R) + ext, py(0));
    ctx.moveTo(px(0), py(-R) + ext * 0.5); ctx.lineTo(px(0), py(R) - ext);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px(R) + ext + ah * 0.6, py(0));
    ctx.lineTo(px(R) + ext - ah, py(0) - ah * 0.7);
    ctx.lineTo(px(R) + ext - ah, py(0) + ah * 0.7);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px(0), py(R) - ext - ah * 0.6);
    ctx.lineTo(px(0) - ah * 0.7, py(R) - ext + ah);
    ctx.lineTo(px(0) + ah * 0.7, py(R) - ext + ah);
    ctx.closePath(); ctx.fill();

    // 軸名稱
    var labelSize = Math.max(11, Math.round(cell * 0.5));
    ctx.font = 'italic 700 ' + labelSize + 'px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('x', px(R) + ext * 0.75, py(0) + labelSize * 0.95);
    ctx.fillText('y', px(0) + labelSize * 0.9, py(R) - ext * 0.8);

    // 刻度數字
    var tickSize = Math.max(9, Math.round(cell * 0.34));
    ctx.font = '600 ' + tickSize + 'px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(28, 35, 49, 0.72)';
    for (i = -R; i <= R; i++) {
      if (i === 0) continue;
      if (!at(i, 0)) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(num(i), px(i), py(0) + cell * 0.14);
      }
      if (!at(0, i)) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(num(i), px(0) - cell * 0.16, py(i));
      }
    }
    if (!at(0, 0)) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('O', px(0) - cell * 0.16, py(0) + cell * 0.14);
    }

    // 棋子
    var last = state.moves[state.moves.length - 1];
    for (i = 0; i < state.moves.length; i++) {
      drawStone(state.moves[i].x, state.moves[i].y, state.moves[i].player, 1);
    }
    if (last) {
      ctx.fillStyle = '#c93a22';
      ctx.beginPath();
      ctx.arc(px(last.x), py(last.y), cell * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    // 勝利連線
    if (state.winLine) {
      var a = state.winLine[0], b = state.winLine[state.winLine.length - 1];
      ctx.strokeStyle = '#c93a22';
      ctx.lineWidth = Math.max(3, cell * 0.16);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px(a.x), py(a.y));
      ctx.lineTo(px(b.x), py(b.y));
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // 預覽棋子
    if (state.hover && !state.over && !state.thinking && state.input === 'click' && !at(state.hover.x, state.hover.y)) {
      drawStone(state.hover.x, state.hover.y, state.player, 0.4);
    }
  }

  function drawStone(x, y, player, alpha) {
    var cx = px(x), cy = py(y), r = cell * 0.43;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (alpha === 1) {
      ctx.shadowColor = 'rgba(28, 35, 49, 0.3)';
      ctx.shadowBlur = cell * 0.18;
      ctx.shadowOffsetY = cell * 0.06;
    }
    var g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    if (player === BLACK) { g.addColorStop(0, '#5f6676'); g.addColorStop(0.7, '#141922'); g.addColorStop(1, '#0c0f15'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(0.8, '#e9e5d9'); g.addColorStop(1, '#cfcabb'); }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1;
    ctx.strokeStyle = player === BLACK ? '#0c0f15' : 'rgba(28, 35, 49, 0.55)';
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 遊戲規則 ---------- */
  function findWin(x, y, player) {
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var line = [{ x: x, y: y }];
      var cx = x + dx, cy = y + dy;
      while (inRange(cx, cy) && at(cx, cy) === player) { line.push({ x: cx, y: cy }); cx += dx; cy += dy; }
      cx = x - dx; cy = y - dy;
      while (inRange(cx, cy) && at(cx, cy) === player) { line.unshift({ x: cx, y: cy }); cx -= dx; cy -= dy; }
      if (line.length >= 5) return line;
    }
    return null;
  }

  function place(x, y) {
    if (state.over || !inRange(x, y) || at(x, y)) return false;
    var player = state.player;
    state.grid[key(x, y)] = player;
    state.moves.push({ x: x, y: y, player: player });
    var line = findWin(x, y, player);
    if (line) {
      state.over = true;
      state.winLine = line;
    } else if (state.moves.length === N * N) {
      state.over = true;
    } else {
      state.player = player === BLACK ? WHITE : BLACK;
    }
    render();
    if (!state.over && state.opponent === 'ai' && state.player === WHITE) scheduleAi();
    return true;
  }

  function scheduleAi() {
    state.thinking = true;
    render();
    aiTimer = setTimeout(function () {
      aiTimer = null;
      state.thinking = false;
      var m = aiMove();
      if (m) place(m.x, m.y); else render();
    }, 420);
  }

  function cancelAi() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    state.thinking = false;
  }

  function undo() {
    if (!state.moves.length) return;
    cancelAi();
    var steps = 1;
    if (state.opponent === 'ai') {
      var lastPlayer = state.moves[state.moves.length - 1].player;
      steps = lastPlayer === WHITE ? 2 : 1;
    }
    while (steps-- > 0 && state.moves.length) {
      var m = state.moves.pop();
      delete state.grid[key(m.x, m.y)];
      state.player = m.player;
    }
    state.over = false;
    state.winLine = null;
    render();
  }

  function reset() {
    cancelAi();
    state.grid = {};
    state.moves = [];
    state.player = BLACK;
    state.over = false;
    state.winLine = null;
    state.hover = null;
    formMsg.textContent = '';
    xInput.value = '';
    yInput.value = '';
    render();
  }

  /* ---------- 電腦對手 ---------- */
  function scoreAt(x, y, player) {
    var total = 0;
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var count = 1, open = 0;
      var cx = x + dx, cy = y + dy;
      while (inRange(cx, cy) && at(cx, cy) === player) { count++; cx += dx; cy += dy; }
      if (inRange(cx, cy) && !at(cx, cy)) open++;
      cx = x - dx; cy = y - dy;
      while (inRange(cx, cy) && at(cx, cy) === player) { count++; cx -= dx; cy -= dy; }
      if (inRange(cx, cy) && !at(cx, cy)) open++;
      if (count >= 5) total += 100000;
      else if (count === 4) total += open === 2 ? 12000 : open === 1 ? 1600 : 0;
      else if (count === 3) total += open === 2 ? 1200 : open === 1 ? 120 : 0;
      else if (count === 2) total += open === 2 ? 110 : open === 1 ? 12 : 0;
      else total += open;
    }
    return total;
  }

  function aiMove() {
    if (!state.moves.length) return { x: 0, y: 0 };
    var best = null, bestScore = -1;
    for (var x = -R; x <= R; x++) {
      for (var y = -R; y <= R; y++) {
        if (at(x, y) || !hasNeighbour(x, y)) continue;
        var s = scoreAt(x, y, WHITE) * 1.08 + scoreAt(x, y, BLACK) + (R * 2 - Math.abs(x) - Math.abs(y)) * 0.05 + Math.random() * 0.5;
        if (s > bestScore) { bestScore = s; best = { x: x, y: y }; }
      }
    }
    return best;
  }

  function hasNeighbour(x, y) {
    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -2; dy <= 2; dy++) {
        if ((dx || dy) && at(x + dx, y + dy)) return true;
      }
    }
    return false;
  }

  /* ---------- 介面更新 ---------- */
  function render() {
    draw();

    var waitingAi = state.thinking;
    canvas.classList.toggle('locked', state.over || waitingAi || state.input === 'type');
    turnStone.className = 'stone ' + (state.player === BLACK ? 'black' : 'white');
    if (state.over) {
      turnText.textContent = state.winLine ? playerName(state.player) + '勝出' : '和局';
    } else if (waitingAi) {
      turnText.textContent = '電腦思考中…';
    } else if (state.opponent === 'ai') {
      turnText.textContent = '輪到你（黑子）';
    } else {
      turnText.textContent = '輪到' + playerName(state.player);
    }

    undoBtn.disabled = state.moves.length === 0;
    coordForm.querySelector('button').disabled = state.over || waitingAi;

    // 落子記錄（最新的排最前）
    movesList.innerHTML = '';
    for (var i = state.moves.length - 1; i >= 0; i--) {
      var m = state.moves[i];
      var li = document.createElement('li');
      li.innerHTML = '<span class="num">' + (i + 1) + '.</span>' +
        '<span class="stone ' + (m.player === BLACK ? 'black' : 'white') + '" role="img" aria-label="' + playerName(m.player) + '"></span>' +
        '<span class="xy">' + coord(m.x, m.y) + '</span>' +
        '<span class="where">' + describe(m.x, m.y) + '</span>';
      movesList.appendChild(li);
    }
    movesEmpty.hidden = state.moves.length > 0;

    // 結果
    if (state.over) {
      if (state.winLine) {
        resultTitle.textContent = playerName(state.player) + '連成五子，勝出！';
        resultLine.textContent = lineEquation(state.winLine);
        resultCoords.textContent = state.winLine.map(function (p) { return coord(p.x, p.y); }).join('　');
      } else {
        resultTitle.textContent = '棋盤下滿了，和局！';
        resultLine.textContent = '';
        resultCoords.textContent = '';
      }
      resultBox.hidden = false;
    } else {
      resultBox.hidden = true;
    }
    if (!state.hover || state.over) hoverTip.hidden = true;
  }

  /* ---------- 輸入 ---------- */
  function pointToCoord(evt) {
    var rect = canvas.getBoundingClientRect();
    var scale = size / rect.width;
    var mx = (evt.clientX - rect.left) * scale;
    var my = (evt.clientY - rect.top) * scale;
    var x = Math.round((mx - margin) / cell) - R;
    var y = R - Math.round((my - margin) / cell);
    if (!inRange(x, y)) return null;
    if (Math.abs(px(x) - mx) > cell * 0.48 || Math.abs(py(y) - my) > cell * 0.48) return null;
    return { x: x, y: y };
  }

  canvas.addEventListener('pointermove', function (evt) {
    if (evt.pointerType === 'touch') return;
    var c = pointToCoord(evt);
    if (state.input !== 'click' || state.over || state.thinking) c = null;
    state.hover = c;
    if (c) {
      hoverTip.textContent = coord(c.x, c.y);
      hoverTip.style.left = (px(c.x) / size * 100) + '%';
      hoverTip.style.top = (py(c.y) / size * 100) + '%';
      hoverTip.hidden = false;
    } else {
      hoverTip.hidden = true;
    }
    draw();
  });

  canvas.addEventListener('pointerleave', function () {
    state.hover = null;
    hoverTip.hidden = true;
    draw();
  });

  canvas.addEventListener('click', function (evt) {
    if (state.over || state.thinking) return;
    if (state.input === 'type') {
      formMsg.textContent = '現在是「輸入座標」模式，請輸入 x 和 y 再按「落子」。';
      xInput.focus();
      return;
    }
    var c = pointToCoord(evt);
    if (!c) return;
    if (at(c.x, c.y)) { formMsg.textContent = coord(c.x, c.y) + ' 已經有棋子。'; return; }
    formMsg.textContent = '';
    place(c.x, c.y);
  });

  coordForm.addEventListener('submit', function (evt) {
    evt.preventDefault();
    if (state.over || state.thinking) return;
    var xs = xInput.value.trim(), ys = yInput.value.trim();
    var x = Number(xs), y = Number(ys);
    if (xs === '' || ys === '' || !Number.isInteger(x) || !Number.isInteger(y) || !inRange(x, y)) {
      formMsg.textContent = 'x 和 y 必須是 \u22127 至 7 的整數。';
      return;
    }
    if (at(x, y)) { formMsg.textContent = coord(x, y) + ' 已經有棋子，請選另一點。'; return; }
    formMsg.textContent = '';
    place(x, y);
    xInput.value = '';
    yInput.value = '';
    xInput.focus();
  });

  Array.prototype.forEach.call(document.querySelectorAll('input[name="opponent"]'), function (el) {
    el.addEventListener('change', function () {
      state.opponent = el.value;
      reset();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('input[name="input"]'), function (el) {
    el.addEventListener('change', function () {
      state.input = el.value;
      state.hover = null;
      hoverTip.hidden = true;
      formMsg.textContent = '';
      render();
      if (el.value === 'type') xInput.focus();
    });
  });

  undoBtn.addEventListener('click', undo);
  resetBtn.addEventListener('click', reset);
  againBtn.addEventListener('click', reset);

  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
  window.addEventListener('resize', resize);
  resize();
  render();

  // 方便測試
  window.__gomoku = { state: state, place: place, reset: reset };
})();
