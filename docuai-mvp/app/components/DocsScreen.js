import { useEffect, useRef, useState } from "react";
import Icon, { PdfBadge } from "./Icon";
import { SwipeCard } from "./ui";
import { SORTS, fmtDate, fmtSize, sortDocs } from "./data";

function StatusBadge({ status }) {
  if (status === "success")
    return (
      <span className="status success">
        <Icon name="checkCircle" size={20} />완료
      </span>
    );
  if (status === "progress")
    return (
      <span className="status progress">
        <span className="spinner" aria-hidden="true" />분석 중
      </span>
    );
  return (
    <span className="status fail">
      <Icon name="alertCircle" size={20} />분석 실패
    </span>
  );
}

const STATUS_TEXT = { success: "분석 완료", progress: "분석 중", fail: "분석 실패" };

export default function DocsScreen({ docs, sortKey, setSortKey, removingId, onOpenDoc, onRename, onDelete, onUpload, onSoon, nav }) {
  const [openId, setOpenId] = useState(null);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  const sorted = sortDocs(docs, sortKey);
  const sortLabel = SORTS.find((s) => s.key === sortKey)?.label;

  // 정렬 메뉴: 바깥 클릭 / Esc 로 닫기
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e) => !sortRef.current?.contains(e.target) && setSortOpen(false);
    const onKey = (e) => e.key === "Escape" && setSortOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  // 카드 밖을 누르면 열린 스와이프는 닫는다
  useEffect(() => {
    if (!openId) return;
    const close = (e) => {
      if (e.type === "pointerdown" && e.target.closest?.(".swipe")) return;
      setOpenId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openId]);

  return (
    <div className="screen">
      {/* 고정: 상단 바 */}
      <header className="fixed-col topbar">
        <span className="logo-circle">
          <Icon name="sparkles" size={22} />
        </span>
        <h1>My Documents</h1>
        <button className="icon-btn" aria-label="검색" onClick={() => onSoon("검색")}>
          <Icon name="search" size={26} />
        </button>
        <button className="icon-btn" aria-label="알림 (새 알림 있음)" onClick={() => onSoon("알림")}>
          <Icon name="bell" size={26} />
          <span className="dot" />
        </button>
      </header>

      {/* 같이 스크롤되는 내용 */}
      <main className="content">
        <div className="list-head">
          <h2>전체 문서</h2>
          <span className="pill-count">총 {docs.length}개</span>
          <div className="sort-wrap" ref={sortRef}>
            <button
              className="sort-btn"
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((v) => !v)}
            >
              {sortLabel}
              <Icon name="chevronDown" size={20} />
            </button>
            {sortOpen && (
              <div className="sort-menu" role="menu" aria-label="정렬 기준">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    role="menuitemradio"
                    aria-checked={s.key === sortKey}
                    onClick={() => {
                      setSortKey(s.key);
                      setSortOpen(false);
                    }}
                  >
                    {s.label}
                    {s.key === sortKey && <Icon name="check" size={18} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="doc-list">
          {sorted.length === 0 && (
            <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--text-3)" }}>
              문서가 없습니다. 오른쪽 아래 + 버튼으로 PDF를 올려 보세요.
            </div>
          )}
          {sorted.map((d) => (
            <SwipeCard
              key={d.id}
              open={openId === d.id}
              removing={removingId === d.id}
              label={`${d.name}, ${fmtDate(d.date)}, ${fmtSize(d.size)}, ${STATUS_TEXT[d.status]}. 왼쪽으로 밀면 이름변경과 삭제`}
              onOpen={() => setOpenId(d.id)}
              onClose={() => setOpenId((cur) => (cur === d.id ? null : cur))}
              onTap={() => onOpenDoc(d)}
              onEdit={() => {
                setOpenId(null);
                onRename(d);
              }}
              onDelete={() => {
                setOpenId(null);
                onDelete(d);
              }}
            >
              <div className="doc-row">
                <PdfBadge size={58} />
                <div className="doc-main">
                  <div className="doc-name ellipsis">{d.name}</div>
                  <div className="doc-meta">
                    {fmtDate(d.date)} · {fmtSize(d.size)}
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>
              {d.status === "progress" && d.delayed && (
                <div className="notice">
                  <Icon name="info" size={22} />
                  <span>분석이 예상보다 길어지고 있습니다. 잠시 후 확인해 주세요.</span>
                </div>
              )}
            </SwipeCard>
          ))}
        </div>
      </main>

      {/* 고정: + 버튼 (스크롤해도 같은 자리) */}
      <div className="fixed-col fab-layer">
        <button className="fab" aria-label="PDF 업로드" onClick={onUpload}>
          <Icon name="plus" size={30} stroke={2.4} />
        </button>
      </div>

      {nav}
    </div>
  );
}
