import { useRef, useState } from "react";
import Icon, { PdfBadge } from "./Icon";
import { MB, fmtSize } from "./data";

const MAX = 50 * MB;
const STEPS = ["파일 선택", "분석 중", "결과 확인", "완료"];

// 파일 내용 첫 5바이트가 %PDF- 인지 확인 (확장자만 바꾼 파일 차단)
async function looksLikePdf(file) {
  try {
    const head = await file.slice(0, 5).text();
    return head === "%PDF-";
  } catch {
    return false;
  }
}

export default function UploadScreen({ files, setFiles, onBack, onSoon, onInvalid }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const addFiles = async (list) => {
    const accepted = [];
    let rejected = false;
    for (const f of Array.from(list || [])) {
      const okName = /\.pdf$/i.test(f.name);
      const okType = !f.type || f.type === "application/pdf";
      if (!okName || !okType || f.size > MAX || f.size === 0 || !(await looksLikePdf(f))) {
        rejected = true;
        continue;
      }
      accepted.push({ id: `${f.name}-${f.size}-${f.lastModified}`, name: f.name, size: f.size });
    }
    if (accepted.length) {
      setFiles((cur) => {
        const ids = new Set(cur.map((x) => x.id));
        return [...cur, ...accepted.filter((x) => !ids.has(x.id))];
      });
    }
    if (rejected) onInvalid(); // F-03: .pdf 가 아니거나 50MB 초과 → 안내 모달
  };

  return (
    <div className="screen">
      {/* 고정: 상단 바 */}
      <header className="fixed-col topbar">
        <button className="icon-btn" aria-label="뒤로가기" onClick={onBack}>
          <Icon name="chevronLeft" size={30} stroke={2.4} />
        </button>
        <h1>파일 업로드</h1>
        <button className="avatar-btn" aria-label="내 프로필" onClick={() => onSoon("프로필")}>
          <Icon name="user" size={22} />
        </button>
      </header>

      {/* 같이 스크롤되는 내용 */}
      <main className="upload-content">
        <ol className="stepper" aria-label="업로드 진행 단계" style={{ listStyle: "none", padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s} className={`step${i === 0 ? " on" : ""}`} aria-current={i === 0 ? "step" : undefined}>
              <span className="step-dot">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>

        <div
          className={`dropzone${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <span className="dz-icon">
            <Icon name="filePlus" size={38} />
          </span>
          <h3>파일을 선택하거나 여기로 드래그하세요</h3>
          <p>PDF 파일만 업로드할 수 있습니다. (최대 50MB)</p>
          <button className="btn-ghost" onClick={() => input.current?.click()}>
            <Icon name="folderOpen" size={22} />
            파일찾기
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="hint">
          <Icon name="sparkles" size={22} />
          <span>표, 다단 구성, 스캔 문서도 고정밀 OCR 엔진으로 정확히 분석합니다.</span>
        </div>

        <div className="section-head">
          <h3>선택한 파일</h3>
          <span className="pill-count">{files.length}개 대기 중</span>
        </div>

        {files.length === 0 && <div className="card empty-file">아직 선택한 파일이 없습니다.</div>}
        {files.map((f) => (
          <div className="card file-card" key={f.id}>
            <PdfBadge size={52} />
            <div className="doc-main">
              <div className="doc-name ellipsis" style={{ fontSize: 16.5 }}>
                {f.name}
              </div>
              <div className="file-sub">
                {fmtSize(f.size, true)}
                <span className="sep" />
                <span className="ok">
                  <Icon name="checkCircle" size={16} />준비 완료
                </span>
              </div>
            </div>
            <button
              className="icon-btn"
              aria-label={`${f.name} 선택 취소`}
              onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}
            >
              <Icon name="x" size={24} style={{ color: "var(--text-3)" }} />
            </button>
          </div>
        ))}

        <section className="guide" aria-label="사전 분석 가이드">
          <div className="guide-head">
            사전 분석 가이드
            <button onClick={() => onSoon("요약 미리보기")}>요약 미리보기</button>
          </div>
          <div className="guide-grid">
            <div className="guide-card">
              <b>
                <Icon name="insight" size={18} />핵심 인사이트
              </b>
              <p>문서 전체를 3줄 요약 및 질의응답 앵커로 변환합니다.</p>
            </div>
            <div className="guide-card">
              <b>
                <Icon name="grid" size={18} />데이터 테이블
              </b>
              <p>도표와 수치를 식별하여 구조화된 시트로 추출합니다.</p>
            </div>
          </div>
        </section>
      </main>

      {/* 고정: 다음 버튼 */}
      <div className="fixed-col bottom-cta">
        <button className="btn-primary" disabled={files.length === 0} onClick={() => onSoon("분석 단계")}>
          다음
          <Icon name="arrowRight" size={24} stroke={2.4} />
        </button>
      </div>
    </div>
  );
}
