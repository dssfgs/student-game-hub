// GitHub API 用戶端：把檔案一次過提交到儲存庫（Git Data API），並更新 games.json。

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.detail = detail;
  }
}

function friendlyMessage(status, body, headers) {
  const msg = (body && body.message) || '';
  if (status === 401) return 'GitHub 權杖無效或已過期，請通知老師到「老師管理」重新設定。';
  if (status === 403 && headers && headers.get('x-ratelimit-remaining') === '0') return 'GitHub 暫時限制了請求次數，請等幾分鐘再試。';
  if (status === 403 && /secondary rate limit|abuse/i.test(msg)) return '上傳太頻密，GitHub 要求稍等一會，請一分鐘後再試。';
  if (status === 403) return 'GitHub 權杖沒有寫入這個儲存庫的權限，請通知老師檢查權杖設定（Contents 需要 Read and write）。';
  if (status === 404) return '找不到儲存庫或權杖沒有存取權，請通知老師檢查設定。';
  if (status === 409) return '儲存庫正在更新，請再試一次。';
  if (status === 413 || /too large/i.test(msg)) return '檔案太大，GitHub 不接受。請壓縮圖片或音效後再試。';
  if (status >= 500) return 'GitHub 伺服器暫時出現問題，請稍後再試。';
  return 'GitHub 回應錯誤（' + status + '）：' + msg;
}

export function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToB64(bytes);
}

export function bytesToB64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export class GitHub {
  constructor({ owner, repo, branch = 'main', token }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    this.base = `${API}/repos/${owner}/${repo}`;
  }

  async req(method, path, body, { raw = false, okStatuses = [] } = {}) {
    const headers = {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      });
    } catch (e) {
      throw new GitHubError('連不上 GitHub，請檢查網絡後再試。', 0, String(e));
    }
    if (okStatuses.includes(res.status)) return { status: res.status };
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch (e) { /* ignore */ }
      throw new GitHubError(friendlyMessage(res.status, data, res.headers), res.status, data);
    }
    if (res.status === 204) return null;
    return raw ? res.text() : res.json();
  }

  // 檢查權杖能否寫入這個儲存庫
  async verify() {
    const info = await this.req('GET', '');
    const canPush = !!(info.permissions && info.permissions.push);
    return { canPush, fullName: info.full_name, isPrivate: info.private, defaultBranch: info.default_branch };
  }

  async getHead() {
    const ref = await this.req('GET', `/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const commitSha = ref.object.sha;
    const commit = await this.req('GET', `/git/commits/${commitSha}`);
    return { commitSha, treeSha: commit.tree.sha };
  }

  async readText(path, ref) {
    const p = path.split('/').map(encodeURIComponent).join('/');
    return this.req('GET', `/contents/${p}?ref=${encodeURIComponent(ref || this.branch)}`, undefined, { raw: true });
  }

  async readJson(path, ref, fallback) {
    try {
      return JSON.parse(await this.readText(path, ref));
    } catch (e) {
      if (fallback !== undefined && (e.status === 404 || e instanceof SyntaxError)) return fallback;
      throw e;
    }
  }

  async createBlob(base64) {
    const blob = await this.req('POST', '/git/blobs', { content: base64, encoding: 'base64' });
    return blob.sha;
  }

  // 列出某個資料夾下的所有檔案路徑
  async listTree(treeSha, prefix) {
    const tree = await this.req('GET', `/git/trees/${treeSha}?recursive=1`);
    return tree.tree.filter((t) => t.type === 'blob' && t.path.startsWith(prefix)).map((t) => t.path);
  }

  /**
   * 以單一提交寫入多項更改；若同時有其他人上傳而發生衝突，會自動重試。
   * build(head) 需回傳 { message, entries }，entries 為：
   *   { path, sha }            已建立的 blob
   *   { path, content }        文字內容
   *   { path, remove: true }   刪除檔案
   */
  async commit(build, { retries = 6 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      const head = await this.getHead();
      const { message, entries } = await build(head);
      const tree = entries.map((e) => {
        const item = { path: e.path, mode: '100644', type: 'blob' };
        if (e.remove) item.sha = null;
        else if (e.sha) item.sha = e.sha;
        else item.content = e.content;
        return item;
      });
      const newTree = await this.req('POST', '/git/trees', { base_tree: head.treeSha, tree });
      const newCommit = await this.req('POST', '/git/commits', { message, tree: newTree.sha, parents: [head.commitSha] });
      try {
        await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: newCommit.sha, force: false });
        return newCommit.sha;
      } catch (e) {
        // 422 = 分支在我們準備期間被別人更新了，重新讀取再試
        if (e.status === 422 || e.status === 409) {
          lastError = e;
          await new Promise((r) => setTimeout(r, 400 + Math.random() * 900));
          continue;
        }
        throw e;
      }
    }
    throw new GitHubError('同一時間太多人上傳，請稍等幾秒再按一次上傳。', 422, lastError && lastError.detail);
  }
}
