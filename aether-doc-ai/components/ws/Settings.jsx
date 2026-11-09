'use client';
// S-10 설정: 프로필, 기본 도메인 모드(F-25), 위젯 노출 항목(F-19), 캘린더 권한 상태(F-16), 로그아웃
import Icon from '../Icon';
import ThemeToggle from '../ThemeToggle';
import { auth } from '@/lib/api';
import { useApp } from '@/lib/store';

function Row({ icon, title, value, note, children }) {
  return (
    <div className="set-row">
      <span className="set-ico">
        <Icon name={icon} />
      </span>
      <span className="set-main">
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      {children || <span className="set-val">{value}</span>}
    </div>
  );
}

export default function Settings() {
  const user = useApp((s) => s.user);
  const setAuth = useApp((s) => s.setAuth);
  const openModal = useApp((s) => s.openModal);

  const logout = () =>
    openModal({
      icon: 'logout',
      title: '로그아웃할까요?',
      msg: '다시 이용하려면 이메일로 로그인해야 해요.',
      actions: [
        { label: '취소', variant: 'sec' },
        {
          label: '로그아웃',
          fn: async () => {
            await auth.logout();
            useApp.setState({ docs: [], docState: {}, docsState: 'idle', view: 'home', docId: null });
            setAuth(null);
          },
        },
      ],
    });

  return (
    <div className="page view-anim">
      <h1 className="page-t">설정</h1>

      <section className="card set-card" aria-label="프로필">
        <div className="profile">
          <span className="avatar" aria-hidden="true">
            {(user?.email || '?').slice(0, 1).toUpperCase()}
          </span>
          <span>
            <b>{user?.email}</b>
            <small>이메일 로그인</small>
          </span>
        </div>
      </section>

      <section className="card set-card" aria-label="환경설정">
        <Row icon="domain" title="기본 도메인 모드" note="F-25 · Phase 1에서 제공 예정" value="범용 일반 모드" />
        <Row icon="widgets" title="위젯 노출 항목" note="F-19 · 모바일 앱 전용 (웹 미제공)" value="—" />
        <Row icon="calendar_month" title="캘린더 권한 상태" note="F-16 · 앱은 기기 캘린더, 웹은 일정 파일(.ics)로 제공 예정" value="—" />
        <Row icon="dark_mode" title="화면 테마">
          <ThemeToggle />
        </Row>
      </section>

      <section className="card set-card" aria-label="개인정보 안내">
        <Row icon="shield" title="개인정보 안내" note="올린 문서의 내용은 요약·답변을 만들기 위해 외부 AI 서비스(Google Gemini)로 전달돼요." />
      </section>

      <button className="btn danger full" onClick={logout}>
        <Icon name="logout" /> 로그아웃
      </button>
    </div>
  );
}
