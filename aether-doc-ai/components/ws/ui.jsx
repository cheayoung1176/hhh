'use client';
// 공통 UI 조각: 브레이크포인트, 상태 아이콘, 모달, 토스트, 스켈레톤, 오류 화면
import { useEffect, useMemo, useState } from 'react';
import Icon from '../Icon';
import { docDefaults, useApp } from '@/lib/store';

// ---------------------------------------------------------------- 2.1 브레이크포인트
// Mobile <= 767px, Tablet 768 ~ 1023px, Desktop >= 1024px
export function useBreakpoint() {
  const [bp, setBp] = useState('mobile');
  useEffect(() => {
    const t = window.matchMedia('(min-width: 768px)');
    const d = window.matchMedia('(min-width: 1024px)');
    const on = () => setBp(d.matches ? 'desktop' : t.matches ? 'tablet' : 'mobile');
    on();
    t.addEventListener('change', on);
    d.addEventListener('change', on);
    return () => {
      t.removeEventListener('change', on);
      d.removeEventListener('change', on);
    };
  }, []);
  return bp;
}

// 문서별 화면 상태 (2.3) — 원본만 골라서 기본값과 합친다 (매번 새 객체를 고르면 무한 렌더링)
export function useDocState(id) {
  const raw = useApp((s) => (id ? s.docState[id] : undefined));
  return useMemo(() => ({ ...docDefaults, ...(raw || {}) }), [raw]);
}

// ---------------------------------------------------------------- 형식
export function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
export function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const h = d.getHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- F-05 상태 인디케이터 (색 + 아이콘, 6.2 색상 의존 금지)
export function StatusIcon({ status }) {
  if (status === 'progress')
    return (
      <span className="st st-progress" role="img" aria-label="분석 중">
        <span className="spin" />
      </span>
    );
  if (status === 'success')
    return (
      <span className="st st-success" role="img" aria-label="분석 완료">
        <Icon name="check_circle" fill />
      </span>
    );
  return (
    <span className="st st-fail" role="img" aria-label="분석 실패">
      <Icon name="error" fill />
    </span>
  );
}

// ---------------------------------------------------------------- 모달 (z-index 1000)
export function ModalHost() {
  const modal = useApp((s) => s.modal);
  const close = useApp((s) => s.closeModal);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    setValue(modal?.input?.value || '');
    setBusy(false);
    setErr('');
  }, [modal]);
  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => e.key === 'Escape' && !modal.locked && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, close]);
  if (!modal) return null;
  const run = async (a) => {
    if (!a.fn) return close();
    setBusy(true);
    try {
      const res = await a.fn(value);
      if (res && typeof res === 'object' && res.error) return setErr(res.error);
      if (res !== true) close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mo" onClick={() => !modal.locked && close()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" onClick={(e) => e.stopPropagation()}>
        {modal.icon && (
          <span className={`dlg-ico ${modal.tone || ''}`}>
            <Icon name={modal.icon} fill />
          </span>
        )}
        <h3 id="dlg-t">{modal.title}</h3>
        {modal.msg && <p>{modal.msg}</p>}
        {modal.input && (
          <input
            className="field"
            autoFocus
            aria-label={modal.input.label}
            maxLength={modal.input.maxLength || 100}
            value={value}
            aria-invalid={!!err}
            aria-describedby={err ? 'dlg-err' : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setErr('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && run(modal.actions[modal.actions.length - 1])}
          />
        )}
        {err && (
          <p id="dlg-err" className="field-err" role="alert">
            <Icon name="warning" size={16} /> {err}
          </p>
        )}
        <div className="acts">
          {modal.actions.map((a, i) => (
            <button key={a.label} className={`btn ${a.variant || ''}`} disabled={busy} autoFocus={!modal.input && i === modal.actions.length - 1} onClick={() => run(a)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 토스트 (z-index 2000)
export function ToastHost() {
  const toast = useApp((s) => s.toast);
  const hide = useApp((s) => s.hideToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(hide, 2800);
    return () => clearTimeout(t);
  }, [toast, hide]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone}`} role="status" key={toast.key}>
      <Icon name={toast.icon} fill size={20} />
      {toast.msg}
    </div>
  );
}

// ---------------------------------------------------------------- 스켈레톤 (6.2 무한 스피너 지양)
export function Skeleton({ lines = 4, card = true }) {
  return (
    <div className={card ? 'skel' : 'skel flat'} role="status" aria-label="불러오는 중">
      <i className="sk h" />
      {Array.from({ length: lines }).map((_, i) => (
        <i key={i} className="sk" style={{ width: `${92 - i * 11}%` }} />
      ))}
    </div>
  );
}
export function ListSkeleton({ n = 3 }) {
  return (
    <div className="cards" aria-label="불러오는 중" role="status">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card item sk-item">
          <i className="sk pdf-sk" />
          <span className="inf">
            <i className="sk" style={{ width: '70%' }} />
            <i className="sk" style={{ width: '40%' }} />
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- F-07 데이터 로딩 실패
export function LoadError({ onRetry, message = '데이터를 불러오지 못했습니다.' }) {
  return (
    <div className="load-err" role="alert">
      <Icon name="cloud_off" size={40} />
      <p>{message}</p>
      <button className="btn sec" onClick={onRetry}>
        <Icon name="refresh" /> 재시도
      </button>
    </div>
  );
}

// 서버 상태를 불러오는 작은 훅: {data, error, loading, reload}
export function useLoad(fn, deps) {
  const [st, setSt] = useState({ data: null, error: null, loading: true, n: 0 });
  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setSt((s) => ({ ...s, data, loading: false })))
      .catch((error) => alive && setSt((s) => ({ ...s, error, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, st.n]);
  return { ...st, reload: () => setSt((s) => ({ ...s, n: s.n + 1 })) };
}
