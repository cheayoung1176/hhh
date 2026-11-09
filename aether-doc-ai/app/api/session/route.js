// 로그인 세션 처리 (Next.js 서버에서 실행)
// Refresh Token 은 httpOnly · Secure · SameSite=Strict 쿠키에만 넣는다 → 브라우저 자바스크립트로 읽을 수 없다.
// 브라우저에는 짧게 쓰는 Access Token 만 돌려준다. (명세서 F-02 Web Secure Token Storage)
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_URL = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const COOKIE = 'aether_rt';
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/session',
  maxAge: 60 * 60 * 24 * 30,
};

function fail(status, code, message, extra = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function clientSession(s) {
  return s ? { access_token: s.access_token, expires_in: s.expires_in, user: s.user } : null;
}

export async function POST(req) {
  let input = {};
  try {
    input = await req.json();
  } catch {}
  const { action, email, password } = input;

  if (action === 'logout') {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, '', { ...cookieOptions, maxAge: 0 });
    return res;
  }

  let path;
  let payload;
  if (action === 'login') {
    path = '/auth/login';
    payload = { email, password };
  } else if (action === 'signup') {
    path = '/auth/signup';
    payload = { email, password };
  } else if (action === 'refresh') {
    const rt = req.cookies.get(COOKIE)?.value;
    if (!rt) return fail(401, 'no_session', '로그인이 필요해요.');
    path = '/auth/refresh';
    payload = { refresh_token: rt };
  } else {
    return fail(400, 'bad_action', '알 수 없는 요청이에요.');
  }

  let r;
  try {
    r = await fetch(API_URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    return fail(502, 'server_unreachable', '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  }
  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const res = NextResponse.json(data.error ? data : { error: { code: 'error', message: '요청을 처리하지 못했어요.' } }, { status: r.status });
    if (action === 'refresh') res.cookies.set(COOKIE, '', { ...cookieOptions, maxAge: 0 }); // 만료·변조된 토큰 파기 (F-02)
    return res;
  }

  const session = action === 'signup' ? data.session : data;
  const body = action === 'signup' ? { ...data, session: clientSession(data.session) } : clientSession(data);
  const res = NextResponse.json(body);
  if (session?.refresh_token) res.cookies.set(COOKIE, session.refresh_token, cookieOptions);
  return res;
}
