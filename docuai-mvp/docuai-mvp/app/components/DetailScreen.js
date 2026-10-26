import { useEffect, useRef, useState } from "react";
import Icon, { PdfBadge } from "./Icon";
import { INVALID_STRING, KEYWORDS, SUMMARY_PLAIN, fmtSize, hasScript, questionFor } from "./data";

const TOP_H = 128; // 고정 영역(상단 바 64 + PDF/AI 대화 탭 64) 높이 — CSS --detail-top 과 같아야 함
const SEG_H = 62; // 붙어 있는 요약/목차/키워드 줄 높이

export default function DetailScreen({ doc, onBack, onSoon, notify }) {
  const sumRef = useRef(null);
  const kwRef = useRef(null);
  const [seg, setSeg] = useState("sum");
  const [kw, setKw] = useState("개인정보 보호");
  const [edits, setEdits] = useState({}); // 키워드별로 사용자가 고친 질문
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // 스크롤 위치에 따라 요약/키워드 탭 표시를 맞춘다 (스크롤 스파이)
  useEffect(() => {
    const onScroll = () => {
      const k = kwRef.current?.getBoundingClientRect().top ?? Infinity;
      const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setSeg(k <= TOP_H + SEG_H + 40 || bottom ? "kw" : "sum");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const jump = (ref, key) => {
    setSeg(key);
    const el = ref.current;
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - TOP_H - SEG_H - 8;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SUMMARY_PLAIN);
      notify("요약을 복사했습니다");
    } catch {
      notify("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.");
    }
  };

  const base = kw ? questionFor(kw) : null;
  const question = kw ? edits[kw] ?? base.q : "";

  const startEdit = () => {
    setDraft(question);
    setEditing(true);
  };
  const finishEdit = () => {
    const v = draft.trim();
    if (!v) {
      setEditing(false);
      return;
    }
    if (hasScript(v)) {
      notify(INVALID_STRING); // F-02-2
      return;
    }
    setEdits((cur) => ({ ...cur, [kw]: v.slice(0, 200) }));
    setEditing(false);
  };

  return (
    <div className="screen">
      {/* 고정: 상단 바 + PDF/AI 대화 탭 */}
      <div className="fixed-col detail-top">
        <header className="topbar">
          <button className="icon-btn" aria-label="뒤로가기" onClick={onBack}>
            <Icon name="arrowLeft" size={26} />
          </button>
          <h1>
            <Icon name="fileText" size={24} style={{ color: "var(--primary)" }} />
            PdfViewer
          </h1>
          <button className="icon-btn" aria-label="더보기" onClick={() => onSoon("더보기 메뉴")}>
            <Icon name="moreVertical" size={24} />
          </button>
          <button className="avatar-btn" aria-label="내 프로필" onClick={() => onSoon("프로필")}>
            <Icon name="user" size={22} />
          </button>
        </header>
        <div className="mode-tabs" role="tablist" aria-label="보기 전환">
          <button role="tab" aria-selected="true">
            <Icon name="fileText" size={20} />
            PDF
          </button>
          <button role="tab" aria-selected="false" onClick={() => onSoon("AI 대화")}>
            <Icon name="chatSingle" size={20} />
            AI 대화
          </button>
        </div>
      </div>

      {/* 같이 스크롤되는 내용 */}
      <main className="detail-content">
        <div className="card doc-head">
          <PdfBadge size={52} />
          <div className="doc-main">
            <div className="doc-name ellipsis">{doc.name}</div>
            <div className="doc-meta">
              {doc.pages}페이지 <span className="sep" /> {fmtSize(doc.size, true)} <span className="sep" />
              <span className="done">분석 완료</span>
            </div>
          </div>
          <button className="icon-btn" aria-label="공유" onClick={() => onSoon("공유")}>
            <Icon name="share" size={22} />
          </button>
          <button className="icon-btn" aria-label="다운로드" onClick={() => onSoon("다운로드")}>
            <Icon name="download" size={22} />
          </button>
        </div>

        {/* 스크롤하다 위에 닿으면 고정 영역 바로 아래에 붙는다 */}
        <div className="seg-sticky">
          <div className="seg" role="tablist" aria-label="분석 결과">
            <button role="tab" aria-selected={seg === "sum"} onClick={() => jump(sumRef, "sum")}>
              <Icon name="sparkles" size={18} />
              요약
            </button>
            <button role="tab" aria-selected={false} onClick={() => onSoon("목차")}>
              <Icon name="list" size={18} />
              목차
            </button>
            <button role="tab" aria-selected={seg === "kw"} onClick={() => jump(kwRef, "kw")}>
              <Icon name="hash" size={18} />
              키워드
            </button>
          </div>
        </div>

        <section className="card sum-card" ref={sumRef} aria-labelledby="sum-title">
          <div className="sum-head">
            <span className="ic">
              <Icon name="trending" size={22} />
            </span>
            <h3 id="sum-title">핵심 요약</h3>
            <span className="tag-ai">AI 자동 추출</span>
            <button className="copy-btn" onClick={copy}>
              <Icon name="copy" size={16} />
              복사
            </button>
          </div>
          <p className="sum-text">
            온디바이스 AI 반도체 시장은 보안성과 초저지연성을 바탕으로 연평균 <b>28.5% (CAGR 28.5%)</b>의 고성장이
            전망됩니다. 특히 모바일 및 엣지 디바이스 내 NPU 탑재가 보편화되면서 전력 효율성 극대화와 맞춤형 경량화 모델
            도입이 핵심 경쟁력으로 부상하고 있습니다.
          </p>
          <div className="sum-foot">
            <button className="chip-yellow" onClick={() => onSoon("원문 보기")}>
              <Icon name="fileSearch" size={16} />
              원문 p.12 ~ p.15 기반 요약
            </button>
            <button className="link" onClick={() => onSoon("원문 보기")}>
              출처 원문 보기
              <Icon name="arrowRight" size={18} />
            </button>
          </div>
        </section>

        <section className="card chart-card" aria-label="시장 성장 지표 (CAGR), 2024년부터 2030년까지 연평균 28.5% 성장">
          <div className="chart-head">
            <h3>시장 성장 지표 (CAGR)</h3>
            <span>2024 - 2030</span>
          </div>
          <div className="bars" aria-hidden="true">
            <div className="bar">
              24년
              <i style={{ height: 46, background: "#e2e8fb" }} />
            </div>
            <div className="bar">
              26년
              <i style={{ height: 58, background: "#dbe2fb" }} />
            </div>
            <div className="bar">
              28년
              <i style={{ height: 74, background: "#7dd3fc" }} />
            </div>
            <div className="bar">
              <span className="badge">+28.5%</span>
              <i style={{ height: 92, background: "var(--primary)" }} />
            </div>
          </div>
        </section>

        <section className="kw-section" ref={kwRef} aria-labelledby="kw-title">
          <div className="kw-head">
            <h3 id="kw-title">문서 핵심 키워드</h3>
            <span className="pill-count">{KEYWORDS.length}개</span>
            <span className="link" aria-hidden="true">
              <Icon name="pointer" size={18} />
              탭하여 질문하기
            </span>
          </div>
          <p className="kw-desc">키워드를 누르면 AI가 문서 맥락에 맞춘 질문을 자동으로 생성합니다.</p>
          <div className="chips">
            {KEYWORDS.map((k) => (
              <button
                key={k}
                className="chip"
                aria-pressed={kw === k}
                onClick={() => {
                  setEditing(false);
                  setKw((cur) => (cur === k ? null : k));
                }}
              >
                {kw === k && <Icon name="checkCircle" size={20} />}
                {k}
              </button>
            ))}
          </div>

          {kw && (
            <div className="rec" aria-live="polite">
              <div className="rec-head">
                <Icon name="bot" size={20} />
                선택한 키워드 추천 질문
              </div>
              <div className="rec-box">
                <div className="rec-q">
                  {editing ? (
                    <input
                      autoFocus
                      value={draft}
                      maxLength={200}
                      aria-label="추천 질문 수정"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") finishEdit();
                        if (e.key === "Escape") setEditing(false);
                      }}
                    />
                  ) : (
                    <strong className="ellipsis">{question}</strong>
                  )}
                  <small className="ellipsis">{base.ref}</small>
                </div>
                <button className="send-btn" aria-label="이 질문 보내기" onClick={() => onSoon("AI 대화")}>
                  <Icon name="arrowUp" size={24} stroke={2.4} />
                </button>
              </div>
              <div className="rec-foot">
                <span>질문 즉시 AI 대화 탭으로 이어집니다</span>
                <button onClick={editing ? finishEdit : startEdit}>{editing ? "수정 완료" : "질문 직접 수정"}</button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
