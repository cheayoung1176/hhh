'use client';
// S-01 로그인·회원가입 (F-01-1 자체 로그인, F-02-1 잠금, F-02-2 입력 검사)
// 소셜 로그인(F-01)은 이번 범위에서 제외
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Icon from '../Icon';
import ThemeToggle from '../ThemeToggle';
import { auth, hasBadInput, INVALID_INPUT_MSG } from '@/lib/api';
import { useApp } from '@/lib/store';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const pwOk = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

export default function AuthScreen({ recoveryToken = null, onRecoveryDone = () => {} }) {
  const setAuth = useApp((s) => s.setAuth);
  const openModal = useApp((s) => s.openModal);
  const showToast = useApp((s) => s.showToast);
  const [mode, setMode] = useState(recoveryToken ? 'reset' : 'login'); // login | signup | recover | reset
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const locked = lockedUntil > now;
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  useEffect(() => {
    if (recoveryToken) switchMode('reset'); // 페이지가 열린 채로 링크가 들어온 경우
  }, [recoveryToken]);

  function switchMode(m) {
    setMode(m);
    setErr({});
    setInfo('');
    setPw('');
    setPw2('');
  }

  function validate() {
    const e = {};
    if (mode !== 'reset') {
      if (hasBadInput(email)) e.email = INVALID_INPUT_MSG;
      else if (!EMAIL_RE.test(email.trim())) e.email = '이메일 형식이 올바르지 않습니다.';
    }
    if (mode !== 'recover') {
      const isNew = mode === 'signup' || mode === 'reset';
      if (!pw) e.pw = '비밀번호를 입력해 주세요.';
      else if (isNew && !pwOk(pw)) e.pw = '비밀번호는 영문과 숫자를 섞어 8자 이상으로 입력해 주세요.';
      if (isNew && pw2 !== pw) e.pw2 = '비밀번호가 서로 달라요.';
    }
    setErr(e);
    return !Object.keys(e).length;
  }

  async function submit(ev) {
    ev.preventDefault();
    if (busy || locked || !validate()) return;
    setBusy(true);
    setInfo('');
    try {
      if (mode === 'login') {
        const s = await auth.login(email.trim(), pw);
        setAuth(s.user);
      } else if (mode === 'signup') {
        const r = await auth.signup(email.trim(), pw);
        if (r.session) {
          setAuth(r.session.user);
          showToast('가입을 환영해요!', 'waving_hand', 'ok');
        } else {
          switchMode('login');
          setInfo(r.message || '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.');
        }
      } else if (mode === 'reset') {
        const r = await auth.reset(recoveryToken, pw);
        onRecoveryDone();
        switchMode('login');
        setInfo(r.message);
      } else {
        const r = await auth.recover(email.trim());
        setInfo(r.message);
      }
    } catch (e) {
      if (e.code === 'account_locked') {
        // F-02-1: 보안 경고 모달 + 입력 필드 비활성화
        const sec = e.extra?.retry_after || 300;
        setLockedUntil(Date.now() + sec * 1000);
        setNow(Date.now());
        openModal({ icon: 'lock_clock', tone: 'er', title: '계정이 잠겼습니다', msg: e.message, actions: [{ label: '확인' }] });
      } else if (e.code === 'login_failed') {
        setErr({ pw: e.message });
      } else if (e.extra?.field === 'email' || e.code === 'invalid_email' || e.code?.startsWith('email_taken')) {
        setErr({ email: e.message });
      } else if (e.code === 'reset_expired') {
        onRecoveryDone();
        switchMode('recover');
        setErr({ form: e.message });
      } else if (e.extra?.field === 'password' || e.code === 'weak_password') {
        setErr({ pw: e.message });
      } else {
        setErr({ form: e.message });
      }
    } finally {
      setBusy(false);
    }
  }

  const remain = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const title = { login: '로그인', signup: '회원가입', recover: '비밀번호 찾기', reset: '새 비밀번호 설정' }[mode];

  return (
    <div className="auth">
      <div className="auth-top">
        <Link href="/" className="brand" aria-label="소개 페이지로">
          <span className="logo">
            <Icon name="description" fill />
          </span>
          <span>Aether Doc AI</span>
        </Link>
        <ThemeToggle />
      </div>

      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>{title}</h1>
        <p className="mu">
          {mode === 'recover' ? '가입한 이메일로 비밀번호 재설정 링크를 보내 드려요.' : mode === 'reset' ? '앞으로 사용할 새 비밀번호를 입력해 주세요.' : 'PDF를 올리고, 읽기 전에 먼저 물어보세요.'}
        </p>

        {info && (
          <p className="auth-info" role="status">
            <Icon name="mark_email_read" size={18} /> {info}
          </p>
        )}

        {mode !== 'reset' && (
          <>
        <label className="lbl" htmlFor="email">
          이메일
        </label>
        <input
          id="email"
          className="field"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          disabled={locked}
          aria-invalid={!!err.email}
          aria-describedby={err.email ? 'email-err' : undefined}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        {err.email && (
          <p id="email-err" className="field-err" role="alert">
            {err.email}
          </p>
        )}
          </>
        )}

        {mode !== 'recover' && (
          <>
            <label className="lbl" htmlFor="pw">
              {mode === 'reset' ? '새 비밀번호' : '비밀번호'}
            </label>
            <input
              id="pw"
              className="field"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={pw}
              disabled={locked}
              aria-invalid={!!err.pw}
              aria-describedby={err.pw ? 'pw-err' : mode === 'signup' || mode === 'reset' ? 'pw-hint' : undefined}
              onChange={(e) => setPw(e.target.value)}
            />
            {(mode === 'signup' || mode === 'reset') && !err.pw && (
              <p id="pw-hint" className="hint">
                영문과 숫자를 섞어 8자 이상
              </p>
            )}
            {err.pw && (
              <p id="pw-err" className="field-err" role="alert">
                {err.pw}
              </p>
            )}
          </>
        )}

        {(mode === 'signup' || mode === 'reset') && (
          <>
            <label className="lbl" htmlFor="pw2">
              비밀번호 확인
            </label>
            <input id="pw2" className="field" type="password" autoComplete="new-password" value={pw2} aria-invalid={!!err.pw2} onChange={(e) => setPw2(e.target.value)} />
            {err.pw2 && (
              <p className="field-err" role="alert">
                {err.pw2}
              </p>
            )}
          </>
        )}

        {err.form && (
          <p className="field-err" role="alert">
            {err.form}
          </p>
        )}

        {locked && (
          <p className="lock-note" role="status">
            <Icon name="lock_clock" size={18} /> 잠금 해제까지 {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, '0')}
          </p>
        )}

        <button className="btn full" type="submit" disabled={busy || locked}>
          {busy ? <span className="spin light" /> : mode === 'recover' ? '재설정 링크 보내기' : mode === 'reset' ? '비밀번호 바꾸기' : title}
        </button>

        <div className="auth-links">
          {mode === 'login' ? (
            <>
              <button type="button" className="link" onClick={() => switchMode('signup')}>
                회원가입
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" className="link" onClick={() => switchMode('recover')}>
                비밀번호 찾기
              </button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => switchMode('login')}>
              <Icon name="arrow_back" size={18} /> 로그인으로 돌아가기
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
