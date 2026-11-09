'use client';
// S-02 홈 · S-03 내 문서 · S-04 업로드 진입 · 문서 카드(스와이프)
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useApp } from '@/lib/store';
import { confirmDelete, loadDocs, openDoc, renameDoc, uploadFile } from './actions';
import { formatDate, formatSize, ListSkeleton, LoadError, StatusIcon, useBreakpoint } from './ui';

const SWIPE_MIN = 60;      // 2.5: 60px 이상
const SWIPE_RATIO = 0.2;   // 2.5: 또는 카드 폭의 20% 이상
const ACTIONS_W = 160;

// ---------------------------------------------------------------- 문서 카드 (F-05 상태, F-06-1 스와이프)
export function DocCard({ doc, index = 0 }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const suppressClick = useRef(false); // 밀기 직후 브라우저가 보내는 클릭은 무시
  const [x, setX] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && (setOpen(false), setX(0));
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { x0: e.clientX, y0: e.clientY, base: open ? -ACTIONS_W : 0, moved: false, horiz: null };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.horiz === null && Math.abs(dx) + Math.abs(dy) > 8) d.horiz = Math.abs(dx) > Math.abs(dy);
    if (!d.horiz) return;
    d.moved = true;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setX(Math.max(-ACTIONS_W - 30, Math.min(0, d.base + dx)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d?.moved) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const width = ref.current?.offsetWidth || 320;
    const pulled = -x;
    const shouldOpen = d.base === 0 ? pulled >= SWIPE_MIN || pulled >= width * SWIPE_RATIO : pulled > ACTIONS_W / 2;
    setOpen(shouldOpen);
    setX(shouldOpen ? -ACTIONS_W : 0);
  };
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (open) {
      setOpen(false);
      setX(0);
      return;
    }
    openDoc(doc);
  };
  const toggleMenu = (e) => {
    e.stopPropagation();
    setOpen(!open);
    setX(open ? 0 : -ACTIONS_W);
  };

  const pct = Math.round(doc.progress || 0);
  return (
    <div className="swipe" ref={ref} style={{ '--i': index }}>
      <div className="swipe-acts" aria-hidden={!open}>
        <button className="sw-btn rename" tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); setX(0); renameDoc(doc); }}>
          <Icon name="edit" /> 이름변경
        </button>
        <button className="sw-btn delete" tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); setX(0); confirmDelete(doc); }}>
          <Icon name="delete" /> 삭제
        </button>
      </div>
      <div
        className={`card item st-${doc.status} ${dragging ? 'dragging' : ''}`}
        style={{ transform: `translateX(${x}px)` }}
        role="button"
        tabIndex={0}
        aria-label={`${doc.title}, ${doc.status === 'success' ? '분석 완료' : doc.status === 'progress' ? `분석 중 ${pct}%` : '분석 실패'}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={onClick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openDoc(doc))}
      >
        <span className="pdf">PDF</span>
        <span className="inf">
          <b>{doc.title}</b>
          <small>
            {formatDate(doc.created_at)} · {formatSize(doc.file_size)}
            {doc.status === 'success' && doc.page_count ? ` · ${doc.page_count}페이지` : ''}
          </small>
          {doc.status === 'progress' && (
            <span className="prog" aria-live="polite">
              <span className="prog-track">
                <span className="prog-fill" style={{ width: `${pct}%` }} />
              </span>
              <small>
                {doc.stage || '분석'} · {pct}%
              </small>
              {doc.delayed && <small className="delay">{doc.delay_message}</small>}
            </span>
          )}
          {doc.status === 'fail' && <small className="er-t">분석 실패 · 눌러서 다시 시도</small>}
        </span>
        <StatusIcon status={doc.status} />
        <button className="ib sm more" aria-label="이름변경·삭제 메뉴" onPointerDown={(e) => e.stopPropagation()} onClick={toggleMenu}>
          <Icon name="more_vert" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- S-04 업로드 진입
export function useUploadPicker() {
  const input = useRef(null);
  const el = (
    <input
      ref={input}
      type="file"
      accept=".pdf,application/pdf"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        uploadFile(f);
      }}
    />
  );
  return { pick: () => input.current?.click(), inputEl: el };
}

export function UploadButton({ pick }) {
  return (
    <button className="btn sm upload-btn" onClick={pick}>
      <Icon name="add" /> 업로드
    </button>
  );
}

export function Fab({ pick }) {
  return (
    <button className="fab" onClick={pick} aria-label="PDF 업로드" title="PDF 업로드">
      <Icon name="add" size={30} />
    </button>
  );
}

// 웹은 드래그 앤 드롭 허용 (3.4)
export function useDropUpload(enabled = true) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const has = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const props = enabled
    ? {
        onDragEnter: (e) => {
          if (!has(e)) return;
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        },
        onDragOver: (e) => has(e) && e.preventDefault(),
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        },
        onDrop: (e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          uploadFile(e.dataTransfer?.files?.[0]);
        },
      }
    : {};
  const overlay = over ? (
    <div className="dropzone" aria-hidden="true">
      <div>
        <Icon name="cloud_upload" size={56} />
        <b>여기에 PDF를 놓으세요</b>
        <small>최대 50MB</small>
      </div>
    </div>
  ) : null;
  return { props, overlay };
}

function DocList({ docs, emptyText }) {
  const docsState = useApp((s) => s.docsState);
  const query = useApp((s) => s.query);
  const setQuery = useApp((s) => s.setQuery);
  if (docsState === 'loading' || docsState === 'idle') return <ListSkeleton />;
  if (docsState === 'error' && !docs.length) return <LoadError onRetry={loadDocs} />;
  if (!docs.length) {
    return query ? (
      <div className="empty">
        <Icon name="search_off" size={44} />
        <b>‘{query}’와(과) 일치하는 문서가 없어요</b>
        <button className="btn sec sm" onClick={() => setQuery('')}>
          검색어 지우기
        </button>
      </div>
    ) : (
      <div className="empty">
        <Icon name="note_stack" size={44} />
        <b>아직 문서가 없어요</b>
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="cards">
      {docs.map((d, i) => (
        <DocCard key={d.doc_id} doc={d} index={i} />
      ))}
    </div>
  );
}

function useFiltered(limit) {
  const docs = useApp((s) => s.docs);
  const query = useApp((s) => s.query);
  const q = query.trim().toLowerCase();
  const list = q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  return limit ? list.slice(0, limit) : list;
}

// ---------------------------------------------------------------- S-02 홈
export function HomeView({ pick }) {
  const bp = useBreakpoint();
  const go = useApp((s) => s.go);
  const query = useApp((s) => s.query);
  const setQuery = useApp((s) => s.setQuery);
  const user = useApp((s) => s.user);
  const list = useFiltered(5);
  return (
    <div className="page view-anim">
      <p className="greet">
        {user?.email ? `${user.email.split('@')[0]}님,` : ''} 오늘은 어떤 문서를
        <br />
        <b>먼저 물어볼까요?</b>
      </p>
      <div className="srch" role="search">
        <Icon name="search" />
        <input placeholder="문서를 검색하세요" aria-label="문서 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="ib sm" onClick={() => setQuery('')} aria-label="검색어 지우기">
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="sec-row">
        <h2 className="sec-h">최근 분석 문서</h2>
        <button className="link" onClick={() => go('docs')} aria-label="내 문서로 이동">
          전체 보기 <Icon name="chevron_right" />
        </button>
      </div>
      <DocList docs={list} emptyText="첫 PDF를 올리면 요약과 키워드를 바로 정리해 드려요." />
      {bp !== 'mobile' && (
        <button className="drop" onClick={pick}>
          <Icon name="upload_file" size={30} />
          <span>
            <b>PDF를 끌어다 놓거나 눌러서 업로드</b>
            <small>최대 50MB · .pdf 형식</small>
          </span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- S-03 내 문서
export function DocsView({ pick }) {
  const bp = useBreakpoint();
  const sort = useApp((s) => s.sort);
  const setSort = useApp((s) => s.setSort);
  const list = useFiltered(0);
  return (
    <div className="page view-anim">
      <div className="page-hd">
        <h1 className="page-t">내 문서</h1>
        <div className="hd-r">
          {bp !== 'mobile' && <UploadButton pick={pick} />}
          <label className="sel">
            <span className="sr">정렬</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
              <option value="latest">최신순</option>
              <option value="name">이름순</option>
              <option value="size">용량순</option>
            </select>
          </label>
        </div>
      </div>
      {bp === 'mobile' && <p className="hint swipe-hint">카드를 왼쪽으로 밀면 이름변경·삭제를 할 수 있어요.</p>}
      <DocList docs={list} emptyText="오른쪽 아래 + 버튼으로 PDF를 올려 보세요." />
    </div>
  );
}
