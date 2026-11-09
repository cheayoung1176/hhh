'use client';
// 워크스페이스 루트: 로그인 복원(F-02) → 로그인 화면(S-01) 또는 앱 틀(2.2 레이아웃)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Icon from '../Icon';
import ThemeToggle from '../ThemeToggle';
import { auth, setSessionExpiredHandler } from '@/lib/api';
import { useApp } from '@/lib/store';
import { openChat, openDoc, useDocsLoader, useStatusWatch } from './actions';
import AuthScreen from './AuthScreen';
import Detail from './Detail';
import { DocsView, Fab, HomeView, UploadButton, useDropUpload, useUploadPicker } from './Lists';
import Settings from './Settings';
import { ModalHost, StatusIcon, ToastHost, useBreakpoint } from './ui';

const NAV = [
  ['home', '홈', 'home'],
  ['docs', '내 문서', 'description'],
  ['chat', 'AI 대화', 'forum'],
  ['settings', '설정', 'settings'],
];

function useNav() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const panel = useApp((s) => (s.docId ? s.docState[s.docId]?.panel : null));
  const active = view === 'detail' ? (panel === 'chat' ? 'chat' : 'docs') : view;
  const select = (k) => (k === 'chat' ? openChat() : go(k));
  return { active, select };
}

// 모바일 하단 네비게이션 (z-index 100)
function BottomNav() {
  const { active, select } = useNav();
  return (
    <nav className="bnav" aria-label="하단 메뉴">
      {NAV.map(([k, l, ic]) => (
        <button key={k} className={active === k ? 'on' : ''} onClick={() => select(k)} aria-current={active === k ? 'page' : undefined}>
          <Icon name={ic} fill={active === k} />
          {l}
        </button>
      ))}
    </nav>
  );
}

// 태블릿 상단 글로벌 네비게이션 (고정, z-index 100)
function TopNav({ pick }) {
  const { active, select } = useNav();
  return (
    <header className="tnav">
      <Link href="/" className="brand" aria-label="소개 페이지로">
        <span className="logo">
          <Icon name="description" fill />
        </span>
        <span>Aether Doc AI</span>
      </Link>
      <nav aria-label="주요 메뉴">
        {NAV.map(([k, l, ic]) => (
          <button key={k} className={active === k ? 'on' : ''} onClick={() => select(k)} aria-current={active === k ? 'page' : undefined}>
            <Icon name={ic} fill={active === k} size={20} />
            {l}
          </button>
        ))}
      </nav>
      <span className="sp" />
      <UploadButton pick={pick} />
      <ThemeToggle />
    </header>
  );
}

// 데스크톱 1단 좌측 사이드바 (고정 260px): 글로벌 네비게이션, 전체 문서 목록, [+ 업로드]
function Sidebar({ pick }) {
  const { active, select } = useNav();
  const docs = useApp((s) => s.docs);
  const docId = useApp((s) => s.docId);
  const view = useApp((s) => s.view);
  return (
    <aside className="sidebar" aria-label="사이드바">
      <div className="sb-top">
        <Link href="/" className="brand" aria-label="소개 페이지로">
          <span className="logo">
            <Icon name="description" fill />
          </span>
          <span>Aether Doc AI</span>
        </Link>
        <ThemeToggle />
      </div>
      <button className="btn full" onClick={pick}>
        <Icon name="add" /> 업로드
      </button>
      <nav className="sb-nav" aria-label="주요 메뉴">
        {NAV.map(([k, l, ic]) => (
          <button key={k} className={active === k ? 'on' : ''} onClick={() => select(k)} aria-current={active === k ? 'page' : undefined}>
            <Icon name={ic} fill={active === k} size={20} />
            {l}
          </button>
        ))}
      </nav>
      <h2 className="sb-h">전체 문서 {docs.length ? `(${docs.length})` : ''}</h2>
      <ul className="sb-docs">
        {docs.map((d) => (
          <li key={d.doc_id}>
            <button className={view === 'detail' && docId === d.doc_id ? 'on' : ''} onClick={() => openDoc(d)} title={d.title}>
              <StatusIcon status={d.status} />
              <span>{d.title}</span>
            </button>
          </li>
        ))}
        {!docs.length && <li className="mu sb-empty">아직 문서가 없어요</li>}
      </ul>
    </aside>
  );
}

function MobileHeader() {
  return (
    <header className="mhd">
      <Link href="/" className="brand" aria-label="소개 페이지로">
        <span className="logo">
          <Icon name="description" fill />
        </span>
        <span>Aether Doc AI</span>
      </Link>
      <ThemeToggle />
    </header>
  );
}

function Shell() {
  const bp = useBreakpoint();
  const view = useApp((s) => s.view);
  const docId = useApp((s) => s.docId);
  const { pick, inputEl } = useUploadPicker();
  const drop = useDropUpload(view !== 'detail');
  useDocsLoader();
  useStatusWatch();

  const page =
    view === 'detail' && docId ? (
      <Detail key={docId} docId={docId} />
    ) : view === 'docs' ? (
      <DocsView pick={pick} />
    ) : view === 'settings' ? (
      <Settings />
    ) : (
      <HomeView pick={pick} />
    );

  return (
    <div className={`ws ${bp} v-${view}`} {...drop.props}>
      {bp === 'desktop' && <Sidebar pick={pick} />}
      <div className="ws-main">
        {bp === 'tablet' && <TopNav pick={pick} />}
        {bp === 'mobile' && view !== 'detail' && <MobileHeader />}
        <main className="ws-content">{page}</main>
        {bp === 'mobile' && view !== 'detail' && (
          <>
            {(view === 'home' || view === 'docs') && <Fab pick={pick} />}
            <BottomNav />
          </>
        )}
      </div>
      {inputEl}
      {drop.overlay}
    </div>
  );
}

export default function Workspace() {
  const authState = useApp((s) => s.authState);
  const setAuth = useApp((s) => s.setAuth);
  const [recoveryToken, setRecoveryToken] = useState(null);

  useEffect(() => {
    // F-01-1: 비밀번호 재설정 메일의 링크로 돌아온 경우 (#access_token=…&type=recovery)
    const takeRecovery = () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (hash.get('type') !== 'recovery' || !hash.get('access_token')) return false;
      setRecoveryToken(hash.get('access_token'));
      window.history.replaceState(null, '', window.location.pathname); // 토큰을 주소창에서 지운다
      setAuth(null);
      return true;
    };
    setSessionExpiredHandler(() => {
      if (useApp.getState().authState !== 'in') return;
      setAuth(null);
      useApp.getState().showToast('로그인이 만료되었습니다. 다시 로그인해 주세요.', 'lock', 'er');
    });
    if (!takeRecovery()) auth.restore().then((s) => setAuth(s?.user || null)); // F-02: 쿠키로 로그인 상태 복원
    window.addEventListener('hashchange', takeRecovery);
    return () => window.removeEventListener('hashchange', takeRecovery);
  }, [setAuth]);

  return (
    <>
      {authState === 'loading' ? (
        <div className="boot" role="status" aria-label="불러오는 중">
          <span className="logo big">
            <Icon name="description" fill size={34} />
          </span>
        </div>
      ) : authState === 'out' ? (
        <AuthScreen recoveryToken={recoveryToken} onRecoveryDone={() => setRecoveryToken(null)} />
      ) : (
        <Shell />
      )}
      <ModalHost />
      <ToastHost />
    </>
  );
}
