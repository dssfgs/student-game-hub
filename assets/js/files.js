// 收集、整理和檢查同學選擇的遊戲檔案。

export const LIMITS = {
  maxFiles: 80,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 30 * 1024 * 1024
};

const ALLOWED_EXT = new Set([
  'html', 'htm', 'js', 'mjs', 'css', 'json', 'txt', 'md', 'csv', 'xml', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif', 'bmp',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'mp4', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'wasm', 'glb', 'gltf', 'bin', 'obj', 'mtl', 'fnt', 'atlas'
]);

const JUNK = [/^__MACOSX\//i, /(^|\/)\.DS_Store$/i, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i, /(^|\/)node_modules\//, /(^|\/)\.git\//];

export const COVER_NAME = '__cover.jpg';

export function extOf(path) {
  const m = /\.([^./]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

export function isHtml(path) {
  const e = extOf(path);
  return e === 'html' || e === 'htm';
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// ---------- 讀取來源 ----------

// <input type="file"> 選到的檔案（包括 webkitdirectory 資料夾）
export function fromFileList(fileList) {
  return Array.from(fileList).map((f) => ({ path: f.webkitRelativePath || f.name, blob: f }));
}

// 拖放（支援資料夾）
export async function fromDataTransfer(dt) {
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return fromFileList(dt.files || []);
  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, blob: file });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, prefix + entry.name + '/');
      } while (batch.length);
    }
  }
  for (const e of entries) await walk(e, '');
  return out;
}

// 展開 ZIP（需要 vendor/jszip.min.js）
export async function expandZips(list) {
  const out = [];
  for (const item of list) {
    if (extOf(item.path) !== 'zip') { out.push(item); continue; }
    if (!window.JSZip) throw new Error('無法讀取 ZIP 檔，請改為直接選擇檔案。');
    let zip;
    try {
      zip = await window.JSZip.loadAsync(item.blob);
    } catch (e) {
      throw new Error('「' + item.path + '」不是有效的 ZIP 檔，或者檔案已損壞。');
    }
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    if (names.length > LIMITS.maxFiles * 4) throw new Error('ZIP 內的檔案太多，請只壓縮遊戲需要的檔案。');
    for (const name of names) {
      const blob = await zip.files[name].async('blob');
      out.push({ path: name, blob });
    }
  }
  return out;
}

// ---------- 整理 ----------

function cleanPath(path) {
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

function stripCommonRoot(items) {
  while (items.length && items.every((it) => it.path.includes('/'))) {
    const root = items[0].path.split('/')[0];
    if (!items.every((it) => it.path.startsWith(root + '/'))) break;
    items.forEach((it) => { it.path = it.path.slice(root.length + 1); });
  }
  return items;
}

/**
 * 回傳 { files: [{path, blob, size}], rejected: [{path, reason}], errors: [string] }
 */
export function normalize(list) {
  const rejected = [];
  let items = [];
  for (const it of list) {
    const path = cleanPath(it.path);
    if (!path) { rejected.push({ path: it.path, reason: '路徑不正確' }); continue; }
    if (JUNK.some((re) => re.test(path))) continue;
    if (path.split('/').some((p) => p.startsWith('.'))) continue;
    items.push({ path, blob: it.blob, size: it.blob.size });
  }
  items = stripCommonRoot(items);

  const seen = new Map();
  for (const it of items) {
    const ext = extOf(it.path);
    if (!ALLOWED_EXT.has(ext)) { rejected.push({ path: it.path, reason: '不支援 .' + (ext || '（無副檔名）') + ' 檔案' }); continue; }
    if (it.size > LIMITS.maxFileBytes) { rejected.push({ path: it.path, reason: '超過 ' + fmtBytes(LIMITS.maxFileBytes) }); continue; }
    if (it.size === 0) { rejected.push({ path: it.path, reason: '檔案是空的' }); continue; }
    if (/[\u0000-\u001f<>:"|?*]/.test(it.path) || it.path.length > 180) { rejected.push({ path: it.path, reason: '檔案名稱含有不能使用的符號' }); continue; }
    if (it.path === COVER_NAME) continue;
    seen.set(it.path, it); // 同名檔案以後加入的為準
  }
  const files = Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path));

  const errors = [];
  const total = files.reduce((s, f) => s + f.size, 0);
  if (files.length > LIMITS.maxFiles) errors.push('檔案數目太多（' + files.length + ' 個），最多可上傳 ' + LIMITS.maxFiles + ' 個。');
  if (total > LIMITS.maxTotalBytes) errors.push('檔案總大小是 ' + fmtBytes(total) + '，超過上限 ' + fmtBytes(LIMITS.maxTotalBytes) + '。');
  if (files.length && !files.some((f) => isHtml(f.path))) errors.push('找不到 HTML 檔案。遊戲至少要有一個 .html 檔（例如 index.html）。');
  return { files, rejected, errors, total };
}

// 如果只有一個 HTML 檔而且不叫 index.html，自動改名，網址會較簡潔
export function autoRenameSingleHtml(files) {
  const htmls = files.filter((f) => isHtml(f.path));
  if (htmls.length === 1 && !htmls[0].path.includes('/') && htmls[0].path.toLowerCase() !== 'index.html'
      && !files.some((f) => f.path.toLowerCase() === 'index.html')) {
    const from = htmls[0].path;
    htmls[0].path = 'index.html';
    return from;
  }
  return null;
}

// 可作為「主頁」的 HTML 檔，最有可能的排最前
export function entryCandidates(files) {
  const htmls = files.filter((f) => isHtml(f.path)).map((f) => f.path);
  const rank = (p) => {
    const depth = p.split('/').length - 1;
    const base = p.split('/').pop().toLowerCase();
    let r = depth * 10;
    if (base === 'index.html') r -= 5;
    else if (base === 'index.htm') r -= 4;
    else if (/^(game|main|play|start)\./.test(base)) r -= 2;
    return r;
  };
  return htmls.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ---------- 檢查 HTML 引用的本機檔案 ----------

function resolveRef(fromPath, ref) {
  let clean = ref.split('#')[0].split('?')[0];
  if (!clean) return null;
  try { clean = decodeURIComponent(clean); } catch (e) { /* 保留原樣 */ }
  const base = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')).split('/') : [];
  const parts = clean.startsWith('/') ? [] : base.slice();
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

function isExternal(ref) {
  return /^(https?:)?\/\//i.test(ref) || /^(data|blob|mailto|tel|javascript|about):/i.test(ref) || ref.startsWith('#');
}

const REF_SELECTORS = [
  ['script[src]', 'src'], ['link[rel~="stylesheet"][href]', 'href'], ['link[rel~="icon"][href]', 'href'],
  ['img[src]', 'src'], ['audio[src]', 'src'], ['video[src]', 'src'], ['source[src]', 'src'], ['iframe[src]', 'src']
];

/**
 * 回傳 [{ html, ref, kind }]：
 *   kind = 'missing'  找不到引用的檔案
 *   kind = 'local'    引用了電腦內的路徑（C:\ 或 file://），上傳後一定失效
 */
export async function checkReferences(files) {
  const paths = new Set(files.map((f) => f.path));
  const lower = new Map(files.map((f) => [f.path.toLowerCase(), f.path]));
  const problems = [];
  for (const f of files) {
    if (!isHtml(f.path)) continue;
    const text = await f.blob.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const seen = new Set();
    for (const [sel, attr] of REF_SELECTORS) {
      doc.querySelectorAll(sel).forEach((el) => {
        const ref = (el.getAttribute(attr) || '').trim();
        if (!ref || seen.has(ref)) return;
        seen.add(ref);
        if (/^(file:|[a-zA-Z]:[\\/])/.test(ref)) { problems.push({ html: f.path, ref, kind: 'local' }); return; }
        if (isExternal(ref)) return;
        const target = resolveRef(f.path, ref);
        if (target === null || !target) { problems.push({ html: f.path, ref, kind: 'missing' }); return; }
        if (paths.has(target)) return;
        if (lower.has(target.toLowerCase())) { problems.push({ html: f.path, ref, kind: 'case', actual: lower.get(target.toLowerCase()) }); return; }
        problems.push({ html: f.path, ref, kind: 'missing' });
      });
    }
  }
  return problems;
}

// ---------- 預覽 ----------

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

const STORAGE_SHIM = `<script>(function(){function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}['localStorage','sessionStorage'].forEach(function(n){try{window[n].getItem('x')}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(e2){}}})})();<\/script>`;

// 把主頁 HTML 引用的本機 JS／CSS／圖片內嵌進去，產生可放進 iframe srcdoc 的預覽
export async function buildPreviewHtml(files, entry) {
  const map = new Map(files.map((f) => [f.path, f]));
  const entryFile = map.get(entry);
  if (!entryFile) throw new Error('找不到主頁檔案');
  const doc = new DOMParser().parseFromString(await entryFile.blob.text(), 'text/html');
  const find = (ref) => {
    if (!ref || isExternal(ref)) return null;
    const target = resolveRef(entry, ref.trim());
    return target ? map.get(target) || null : null;
  };

  for (const el of Array.from(doc.querySelectorAll('script[src]'))) {
    const f = find(el.getAttribute('src'));
    if (!f) continue;
    const code = (await f.blob.text()).replace(/<\/script/gi, '<\\/script');
    el.removeAttribute('src');
    el.textContent = code;
  }
  for (const el of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const f = find(el.getAttribute('href'));
    if (!f) continue;
    const style = doc.createElement('style');
    style.textContent = await f.blob.text();
    el.replaceWith(style);
  }
  for (const el of Array.from(doc.querySelectorAll('img[src], audio[src], video[src], source[src]'))) {
    const f = find(el.getAttribute('src'));
    if (!f || f.size > 4 * 1024 * 1024) continue;
    el.setAttribute('src', await blobToDataUrl(f.blob));
  }
  const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  return html.replace(/<head([^>]*)>/i, (m) => m + STORAGE_SHIM);
}

// ---------- 貼上的程式碼 ----------

export function cleanPastedCode(text) {
  let t = String(text || '').trim();
  // 去除 AI 聊天常見的 ```html ... ``` 包裝
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (fence) t = fence[1].trim();
  return t;
}

export function looksLikeHtml(text) {
  return /<!doctype html|<html[\s>]|<body[\s>]|<canvas[\s>]|<script[\s>]|<div[\s>]/i.test(text);
}

// ---------- 封面圖片 ----------

// 把同學選的圖片縮成 800×500 的 JPEG
export async function makeCover(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('無法讀取這張圖片，請換另一張。'));
      im.src = url;
    });
    const W = 800, H = 500;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (!blob) throw new Error('無法處理這張圖片，請換另一張。');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
