// 서버(FastAPI) 연결 모듈
// - Access Token 은 메모리에만 보관 (페이지를 닫으면 사라짐)
// - Refresh Token 은 httpOnly 쿠키에만 보관 → 자바스크립트로 읽을 수 없음 (F-02 Web Secure Token Storage)
// - 401 이 오면 한 번 자동 갱신 후 다시 시도, 그래도 안 되면 로그인 화면으로 (F-02)

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
export const DETAIL_TIMEOUT_MS = 10000; // F-07 상세 데이터 응답 제한 시간 (구현 단계 확정값)

let accessToken = null;
let refreshing = null;
let onSessionExpired = () => {};

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function setAccessToken(t) {
  accessToken = t || null;
}
export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

// ---------------------------------------------------------------- 로그인 세션 (Next.js /api/session 경유)
async function sessionCall(action, payload = {}) {
  let r;
  try {
    r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network', '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = data.error || {};
    throw new ApiError(r.status, e.code || 'error', e.message || '요청을 처리하지 못했어요.', e);
  }
  return data;
}

export const auth = {
  async login(email, password) {
    const s = await sessionCall('login', { email, password });
    setAccessToken(s.access_token);
    return s;
  },
  async signup(email, password) {
    const s = await sessionCall('signup', { email, password });
    if (s.session) setAccessToken(s.session.access_token);
    return s;
  },
  async restore() {
    // 앱을 다시 열었을 때 쿠키의 Refresh Token 으로 로그인 상태 복원 (F-02)
    try {
      const s = await sessionCall('refresh');
      setAccessToken(s.access_token);
      return s;
    } catch {
      setAccessToken(null);
      return null;
    }
  },
  async logout() {
    setAccessToken(null);
    try {
      await sessionCall('logout');
    } catch {}
  },
  recover(email) {
    // 메일의 링크를 누르면 /workspace#access_token=…&type=recovery 로 돌아온다
    const redirect_to = typeof window !== 'undefined' ? `${window.location.origin}/workspace` : undefined;
    return request('/auth/recover', { method: 'POST', body: { email, redirect_to }, noAuth: true });
  },
  reset(accessToken, password) {
    return request('/auth/reset', { method: 'POST', body: { access_token: accessToken, password }, noAuth: true });
  },
};

async function refreshOnce() {
  if (!refreshing) {
    refreshing = auth.restore().finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  }
  return refreshing;
}

// ---------------------------------------------------------------- 일반 요청
function authHeaders(extra = {}) {
  return accessToken ? { Authorization: `Bearer ${accessToken}`, ...extra } : extra;
}

async function toError(r) {
  const data = await r.json().catch(() => ({}));
  const e = data.error || {};
  return new ApiError(r.status, e.code || `http_${r.status}`, e.message || '요청을 처리하지 못했어요.', e);
}

export async function request(path, { method = 'GET', body, form, timeout, signal, noAuth = false, retried = false } = {}) {
  const ctrl = new AbortController();
  const timer = timeout ? setTimeout(() => ctrl.abort('timeout'), timeout) : null;
  if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  let r;
  try {
    r = await fetch(API_URL + path, {
      method,
      headers: noAuth ? (body ? { 'content-type': 'application/json' } : {}) : authHeaders(body ? { 'content-type': 'application/json' } : {}),
      body: form || (body ? JSON.stringify(body) : undefined),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (ctrl.signal.reason === 'timeout') throw new ApiError(0, 'timeout', '데이터를 불러오지 못했습니다.');
    if (signal?.aborted) throw new ApiError(0, 'aborted', '요청을 취소했어요.');
    throw new ApiError(0, 'network', '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (r.status === 401 && !noAuth && !retried) {
    const s = await refreshOnce();
    if (s) return request(path, { method, body, form, timeout, signal, noAuth, retried: true });
    onSessionExpired();
  }
  if (!r.ok) throw await toError(r);
  if (r.status === 204) return null;
  return r.json();
}

// ---------------------------------------------------------------- SSE (fetch 로 스트림 읽기: 헤더에 토큰을 붙이기 위해)
export async function* stream(path, { method = 'GET', body, signal, retried = false } = {}) {
  let r;
  try {
    r = await fetch(API_URL + path, {
      method,
      headers: authHeaders(body ? { 'content-type': 'application/json', Accept: 'text/event-stream' } : { Accept: 'text/event-stream' }),
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    throw new ApiError(0, 'network', '연결이 일시 중단되었습니다');
  }
  if (r.status === 401 && !retried) {
    const s = await refreshOnce();
    if (s) {
      yield* stream(path, { method, body, signal, retried: true });
      return;
    }
    onSessionExpired();
  }
  if (!r.ok) throw await toError(r);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              yield JSON.parse(line.slice(6));
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    throw new ApiError(0, 'stream_broken', '연결이 일시 중단되었습니다');
  }
}

// ---------------------------------------------------------------- 명세서 5.1.4 API
export const docsApi = {
  list: (sort) => request(`/documents?sort=${encodeURIComponent(sort)}`),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/documents', { method: 'POST', form });
  },
  get: (id) => request(`/documents/${id}`, { timeout: DETAIL_TIMEOUT_MS }),
  status: (id) => request(`/documents/${id}/status`),
  events: (id, signal) => stream(`/documents/${id}/events`, { signal }),
  rename: (id, title) => request(`/documents/${id}`, { method: 'PATCH', body: { title } }),
  remove: (id) => request(`/documents/${id}`, { method: 'DELETE' }),
  reanalyze: (id) => request(`/documents/${id}/reanalyze`, { method: 'POST' }),
  summary: (id) => request(`/documents/${id}/summary`, { timeout: DETAIL_TIMEOUT_MS }),
  toc: (id) => request(`/documents/${id}/toc`, { timeout: DETAIL_TIMEOUT_MS }),
  keywords: (id) => request(`/documents/${id}/keywords`, { timeout: DETAIL_TIMEOUT_MS }),
};

export const chatApi = {
  create: (docId) => request(`/documents/${docId}/sessions`, { method: 'POST' }),
  sessions: (docId) => request(`/documents/${docId}/sessions`, { timeout: DETAIL_TIMEOUT_MS }),
  messages: (sid) => request(`/sessions/${sid}/messages`, { timeout: DETAIL_TIMEOUT_MS }),
  ask: (sid, content, signal) => stream(`/sessions/${sid}/messages`, { method: 'POST', body: { content }, signal }),
};

// ---------------------------------------------------------------- F-02-2 입력값 보안 처리 (화면 쪽 1차 검사)
const BAD = /<\s*\/?\s*(script|iframe|object|embed|svg|img|style|link|meta|form)\b|javascript\s*:|vbscript\s*:|\bon[a-z]+\s*=|data\s*:\s*text\/html|<!--/i;
export const INVALID_INPUT_MSG = '유효하지 않은 문자열이 포함되어 있습니다';
export function hasBadInput(text) {
  return BAD.test(text || '');
}
// React 는 텍스트를 화면에 넣을 때 자동으로 HTML Entity 로 바꿔 스크립트 실행을 막는다 (< → &lt;).
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
