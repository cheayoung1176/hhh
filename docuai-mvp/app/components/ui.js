import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

/* ---------------- 토스트 (z 2000, 폰 컬럼 안 고정) ---------------- */
export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="fixed-col toast-layer">
      <div key={toast.id} className="toast" role="status" aria-live="polite">
        {toast.text}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = (text) => {
    clearTimeout(timer.current);
    setToast({ text, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 2300);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

/* ---------------- 모달 (z 1000) ---------------- */
export function Modal({ icon = "info", tone = "info", title, children, onClose, labelledBy = "modal-title" }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // 열릴 때 한 번만: 첫 입력칸(없으면 첫 버튼)에 포커스, 닫히면 원래 위치로 포커스 복귀
    const prev = document.activeElement;
    const first = ref.current?.querySelector("input") || ref.current?.querySelector("button");
    first?.focus();
    const onKey = (e) => e.key === "Escape" && closeRef.current?.();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className={`m-ic ${tone}`}>
          <Icon name={icon} size={26} />
        </div>
        <h3 id={labelledBy}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/* ---------------- 스와이프 카드 (F-06-1) ----------------
   - 왼쪽으로 60px 이상 또는 카드 폭 20% 이상 밀면 [이름변경][삭제]가 열린다.
   - 버튼은 카드 뒤에 붙어 있어서 페이지를 스크롤하면 카드와 함께 움직인다.
   - 세로로 움직이면 스와이프가 아니라 스크롤로 처리한다.
   - 키보드: 카드에 포커스 후 ← 로 열기, → 로 닫기, Enter 로 열람 */
const ACTION_W = 164;

export function SwipeCard({ open, onOpen, onClose, onTap, onEdit, onDelete, removing, label, children }) {
  const front = useRef(null);
  const g = useRef(null); // 제스처 상태
  const [dx, setDx] = useState(null); // 드래그 중일 때만 숫자

  const base = open ? -ACTION_W : 0;
  const x = dx ?? base;

  const down = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    g.current = { sx: e.clientX, sy: e.clientY, dir: null, id: e.pointerId, moved: false };
  };
  const move = (e) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.sx;
    const my = e.clientY - s.sy;
    if (!s.dir && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      s.dir = Math.abs(mx) > Math.abs(my) ? "h" : "v";
      if (s.dir === "h") front.current?.setPointerCapture?.(e.pointerId);
    }
    if (s.dir === "h") {
      s.moved = true;
      let nx = base + mx;
      if (nx > 0) nx = nx / 4; // 오른쪽 끝 고무줄
      if (nx < -ACTION_W) nx = -ACTION_W + (nx + ACTION_W) / 4; // 왼쪽 끝 고무줄
      setDx(nx);
    }
  };
  const up = (e) => {
    const s = g.current;
    g.current = null;
    if (!s || s.id !== e.pointerId) return;
    if (s.dir === "h") {
      const width = front.current?.offsetWidth || 360;
      const threshold = Math.min(60, width * 0.2);
      const pulled = -(dx ?? base);
      setDx(null);
      if (!open) pulled >= threshold ? onOpen() : onClose();
      else pulled < ACTION_W - 40 ? onClose() : onOpen();
      return;
    }
    if (!s.dir) {
      if (open) onClose();
      else onTap();
    }
  };
  const cancel = () => {
    g.current = null;
    setDx(null);
  };
  const key = (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); onOpen(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onClose(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open ? onClose() : onTap(); }
  };

  return (
    <div className={`swipe${removing ? " removing" : ""}${x < 0 ? " revealed" : ""}`}>
      <div className="swipe-actions" aria-hidden={!open}>
        <button className="act-edit" onClick={onEdit} tabIndex={open ? 0 : -1}>
          <Icon name="pencil" size={24} />
          이름변경
        </button>
        <button className="act-del" onClick={onDelete} tabIndex={open ? 0 : -1}>
          <Icon name="trash" size={24} />
          삭제
        </button>
      </div>
      <div
        ref={front}
        className={`swipe-front card doc-card${dx !== null ? " dragging" : ""}`}
        style={{ transform: `translateX(${x}px)` }}
        role="button"
        tabIndex={0}
        aria-label={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onKeyDown={key}
      >
        {children}
      </div>
    </div>
  );
}
