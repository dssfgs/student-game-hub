// 用密碼加密／解密 GitHub 權杖（PBKDF2-SHA256 + AES-GCM）。
// 權杖只會以加密形式儲存在 config.json，瀏覽器輸入正確密碼後才能解開。

const ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export function normalizePassword(pw) {
  return String(pw || '').normalize('NFKC').trim();
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(secret, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

// 密碼錯誤時會擲出 Error('WRONG_PASSWORD')
export async function decryptSecret(box, password) {
  if (!box || !box.ct) throw new Error('NOT_CONFIGURED');
  const key = await deriveKey(password, fromB64(box.salt), box.iter || ITERATIONS);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
    return dec.decode(pt);
  } catch (e) {
    throw new Error('WRONG_PASSWORD');
  }
}
