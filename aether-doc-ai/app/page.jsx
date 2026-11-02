import Link from 'next/link';
import Icon from '@/components/Icon';
import ThemeToggle from '@/components/ThemeToggle';

const FEATURES = [
  { icon: 'summarize', title: '요약 · 목차 · 키워드', text: '올리는 순간 문서의 뼈대가 정리됩니다. 목차를 누르면 해당 페이지로 바로 이동해요.' },
  { icon: 'format_ink_highlighter', title: '답변마다 출처 페이지', text: '근거가 된 문장을 형광펜으로 표시해, AI 답변을 원문에서 바로 확인할 수 있어요.' },
  { icon: 'bolt', title: '실시간 스트리밍 답변', text: '답변이 생성되는 대로 바로 보여 드려요. 키워드 칩 한 번이면 질문도 자동으로.' },
  { icon: 'devices', title: '모바일 · 데스크톱', text: '휴대폰에서는 바텀 시트, 넓은 화면에서는 원문과 대화를 나란히 띄우는 Split View.' },
];

const STEPS = [
  { n: '01', title: 'PDF를 올리세요', text: '끌어다 놓거나 + 버튼으로 선택. 최대 50MB까지 지원합니다.' },
  { n: '02', title: '분석 과정을 지켜보세요', text: '텍스트 추출부터 키워드 추출까지 단계별로 진행 상황을 보여 드려요.' },
  { n: '03', title: '궁금한 걸 물어보세요', text: '답변 아래 출처 칩을 누르면 원문 페이지가 하이라이트와 함께 열립니다.' },
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-hd">
        <Link href="/" className="brand" aria-label="Aether Doc AI 홈">
          <span className="logo">
            <Icon name="description" fill />
          </span>
          <span>Aether Doc AI</span>
        </Link>
        <nav className="lp-nav" aria-label="주요 메뉴">
          <a href="#features">기능</a>
          <a href="#how">사용 방법</a>
        </nav>
        <div className="lp-hd-r">
          <ThemeToggle />
          <Link href="/workspace" className="btn sm">
            시작하기
          </Link>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="badge">
              <Icon name="auto_awesome" fill size={16} /> MAP v.1 공개
            </span>
            <h1>
              긴 PDF,
              <br />
              <span className="grad">읽기 전에 먼저 물어보세요</span>
            </h1>
            <p className="lead">
              올리면 요약·목차·키워드가 바로 정리되고, 질문하면 근거가 된 페이지를 형광펜으로 짚어 드립니다.
            </p>
            <div className="hero-cta">
              <Link href="/workspace?demo=1" className="btn lg">
                샘플 문서로 바로 체험하기 <Icon name="arrow_forward" />
              </Link>
              <Link href="/workspace" className="btn lg ghost">
                <Icon name="upload_file" /> 내 PDF 올리기
              </Link>
            </div>
            <ul className="hero-facts">
              <li>
                <Icon name="check_circle" fill /> 가입 없이 바로 사용
              </li>
              <li>
                <Icon name="check_circle" fill /> PDF 최대 50MB
              </li>
              <li>
                <Icon name="check_circle" fill /> 다크 모드 지원
              </li>
            </ul>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="mock">
              <div className="mock-bar">
                <i />
                <i />
                <i />
                <span>2024_Semiconductor_Outlook_KR.pdf</span>
              </div>
              <div className="mock-body">
                <div className="mock-page">
                  <small>CHAPTER 3.2</small>
                  <b>온디바이스 AI 가속기 수요 전망</b>
                  <p className="ln" />
                  <p className="ln s" />
                  <p className="mock-mark">CAGR은 28.5%로 전망되며…</p>
                  <div className="mock-bars">
                    <i style={{ height: '36%' }} />
                    <i style={{ height: '48%' }} />
                    <i style={{ height: '66%' }} />
                    <i style={{ height: '84%' }} />
                    <i style={{ height: '100%' }} />
                  </div>
                </div>
                <div className="mock-chat">
                  <div className="u">CAGR 전망은?</div>
                  <div className="bub">
                    2024~2028년 칩셋 출하량의 연평균 성장률은 <b>28.5%</b>로 전망됩니다.
                    <i className="cur" />
                  </div>
                  <span className="chip sm">
                    <Icon name="description" size={16} /> p.2
                  </span>
                </div>
              </div>
            </div>
            <div className="float f1">
              <Icon name="check_circle" fill className="ok" /> 분석 완료 · 6페이지
            </div>
            <div className="float f2">
              <Icon name="format_ink_highlighter" className="pr" /> 근거 문장 하이라이트
            </div>
          </div>
        </section>

        <section id="features" className="lp-sec">
          <h2>문서를 읽는 방식이 달라집니다</h2>
          <p className="sub">필요한 것만, 근거와 함께.</p>
          <div className="feat-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="feat">
                <span className="feat-ico">
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="lp-sec">
          <h2>세 단계면 충분해요</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="cta-band">
          <h2>지금 샘플 보고서로 직접 확인해 보세요</h2>
          <p>설치도, 가입도 필요 없어요.</p>
          <Link href="/workspace?demo=1" className="btn lg light">
            무료로 체험하기 <Icon name="arrow_forward" />
          </Link>
        </section>
      </main>

      <footer className="lp-ft">
        <span>© 2026 Aether Doc AI · MAP v.1</span>
        <span>시연 버전: 실제 PDF 파싱·AI 호출 없이 샘플 분석 결과로 동작합니다.</span>
      </footer>
    </div>
  );
}
