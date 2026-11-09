'use client';
// PDF 원문 뷰어 (pdf.js, F-09 하이라이트)
// pdf.js 는 public/pdfjs 에 포함해서 같은 주소에서 불러온다.
// 글꼴 변환표(cmaps, 169개)만 같은 버전을 jsDelivr CDN 에서 받는다 (GitHub 웹 업로드 100개 제한 때문).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useApp } from '@/lib/store';
import { LoadError, useDocState } from './ui';

export const HIGHLIGHT = '#FFF176';
const BASE = '/pdfjs';
const CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/cmaps/';
let libPromise = null;
const docCache = new Map(); // url → Promise<PDFDocumentProxy>

function loadLib() {
  if (!libPromise) {
    // 번들러가 건드리지 않도록 런타임에 불러온다
    // eslint-disable-next-line no-new-func
    libPromise = new Function('u', 'return import(u)')(`${BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return libPromise;
}

export function loadPdf(url) {
  if (!docCache.has(url)) {
    const p = loadLib().then((lib) =>
      lib.getDocument({
        url,
        cMapUrl: CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: `${BASE}/standard_fonts/`,
        wasmUrl: `${BASE}/wasm/`,
        iccUrl: `${BASE}/iccs/`,
      }).promise,
    );
    p.catch(() => docCache.delete(url));
    docCache.set(url, p);
  }
  return docCache.get(url);
}

// 하이라이트 상자: 출처의 highlights(같은 페이지) → 없으면 rect
export function rectsFor(highlight, page) {
  if (!highlight || highlight.page !== page) return [];
  return highlight.rects || [];
}

// ---------------------------------------------------------------- 한 페이지 그리기
function PageCanvas({ pdf, pageNo, scale, visible }) {
  const canvas = useRef(null);
  const task = useRef(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!pdf || !visible) return;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageNo);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale });
      const c = canvas.current;
      if (!c) return;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      task.current?.cancel();
      task.current = page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      try {
        await task.current.promise;
        if (!cancelled) setDone(true);
      } catch {}
    })();
    return () => {
      cancelled = true;
      task.current?.cancel();
    };
  }, [pdf, pageNo, scale, visible]);
  return (
    <>
      {!done && <div className="pg-loading" aria-hidden="true" />}
      <canvas ref={canvas} className="pg-canvas" aria-label={`${pageNo}페이지`} />
    </>
  );
}

function Highlights({ rects, scale, pulseKey }) {
  return rects.map((r, i) => (
    <div
      key={`${pulseKey}-${i}`}
      className="hl"
      style={{ left: r[0] * scale - 3, top: r[1] * scale - 3, width: (r[2] - r[0]) * scale + 6, height: (r[3] - r[1]) * scale + 6, background: HIGHLIGHT }}
    />
  ));
}

// ---------------------------------------------------------------- 문서 전체 뷰어 (태블릿·데스크톱 메인, 모바일 [PDF] 탭)
export default function PdfViewer({ docId, url, pageSizes, onReload }) {
  const ds = useDocState(docId);
  const patchDoc = useApp((s) => s.patchDoc);
  const box = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [err, setErr] = useState(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(() => new Set([1, 2]));
  const refs = useRef({});
  const saveTimer = useRef(null);
  const restored = useRef(false);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setPdf(null);
    loadPdf(url)
      .then((p) => alive && setPdf(p))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [url]);

  // 컨테이너 폭에 맞춰 배율 계산
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pages = pageSizes?.length ? pageSizes : pdf ? Array.from({ length: pdf.numPages }, () => ({ width: 595, height: 842 })) : [];
  const fit = (pw) => Math.max(0.2, ((width || 600) - 32) / pw);
  const scaleOf = (i) => fit(pages[i]?.width || 595) * ds.zoom;

  // 보이는 페이지만 그린다
  useEffect(() => {
    const root = box.current;
    if (!root || !pages.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number(e.target.dataset.page);
            if (e.isIntersecting) next.add(n);
          }
          return next;
        });
      },
      { root, rootMargin: '600px 0px' },
    );
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [pages.length, width, ds.zoom]);

  // 스크롤 위치·현재 페이지를 저장소에 기록 (2.3)
  const onScroll = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const root = box.current;
      if (!root) return;
      const mid = root.scrollTop + root.clientHeight / 3;
      let page = 1;
      for (const [n, el] of Object.entries(refs.current)) if (el && el.offsetTop <= mid) page = Math.max(page, Number(n));
      patchDoc(docId, { scrollTop: root.scrollTop, page });
    }, 120);
  }, [docId, patchDoc]);

  // 처음 열 때 이전 스크롤 위치 복원
  useEffect(() => {
    if (restored.current || !pages.length || !width || !box.current) return;
    restored.current = true;
    if (!ds.highlight) box.current.scrollTop = ds.scrollTop || 0;
  }, [pages.length, width, ds.scrollTop, ds.highlight]);

  // 출처 하이라이트로 이동 (F-09: 해당 위치로 스크롤)
  const hlKey = ds.highlight?.key;
  useEffect(() => {
    const h = ds.highlight;
    if (!h || !width || !box.current) return;
    const el = refs.current[h.page];
    if (!el) return;
    const s = scaleOf(h.page - 1);
    const top = h.rects?.[0] ? h.rects[0][1] * s : 0;
    box.current.scrollTo({ top: Math.max(0, el.offsetTop + top - 80), behavior: 'smooth' });
    setVisible((v) => new Set([...v, h.page]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlKey, width, pages.length]);

  // 목차·페이지 이동 요청
  const jumpKey = ds.jump?.key;
  useEffect(() => {
    const j = ds.jump;
    if (!j || !box.current) return;
    const el = refs.current[j.page];
    if (el) box.current.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpKey, width, pages.length]);

  const zoom = (d) => patchDoc(docId, { zoom: Math.min(2.5, Math.max(0.5, +(ds.zoom + d).toFixed(2))) });
  const go = (n) => patchDoc(docId, { jump: { page: Math.min(pages.length, Math.max(1, n)), key: Date.now() } });

  if (err) return <LoadError onRetry={onReload} message="원문을 불러오지 못했습니다." />;

  return (
    <div className="viewer">
      <div className="viewer-bar" role="toolbar" aria-label="PDF 보기 도구">
        <button className="ib sm" onClick={() => go(ds.page - 1)} disabled={ds.page <= 1} aria-label="이전 페이지">
          <Icon name="chevron_left" />
        </button>
        <span className="pg-ind" aria-live="polite">
          {ds.page} / {pages.length || '…'}
        </span>
        <button className="ib sm" onClick={() => go(ds.page + 1)} disabled={ds.page >= pages.length} aria-label="다음 페이지">
          <Icon name="chevron_right" />
        </button>
        <span className="sep" />
        <button className="ib sm" onClick={() => zoom(-0.15)} aria-label="축소">
          <Icon name="zoom_out" />
        </button>
        <span className="zoom-ind">{Math.round(ds.zoom * 100)}%</span>
        <button className="ib sm" onClick={() => zoom(0.15)} aria-label="확대">
          <Icon name="zoom_in" />
        </button>
        {ds.highlight && (
          <button className="ib sm" onClick={() => patchDoc(docId, { highlight: null })} aria-label="하이라이트 지우기" title="하이라이트 지우기">
            <Icon name="ink_eraser" />
          </button>
        )}
      </div>
      <div className="viewer-scroll" ref={box} onScroll={onScroll}>
        {!pdf && <div className="viewer-loading">원문을 불러오는 중…</div>}
        {pages.map((p, i) => {
          const n = i + 1;
          const s = scaleOf(i);
          return (
            <div
              key={n}
              data-page={n}
              ref={(el) => (refs.current[n] = el)}
              className="pg"
              style={{ width: p.width * s, height: p.height * s }}
            >
              {pdf && <PageCanvas pdf={pdf} pageNo={n} scale={s} visible={visible.has(n)} />}
              <Highlights rects={rectsFor(ds.highlight, n)} scale={s} pulseKey={hlKey} />
              <span className="pg-no">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 한 페이지만 (모바일 출처 바텀 시트 S-08)
export function SinglePage({ url, pageNo, pageSize, highlight }) {
  const box = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [err, setErr] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    loadPdf(url).then(setPdf).catch(() => setErr(true));
  }, [url]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const pw = pageSize?.width || 595;
  const ph = pageSize?.height || 842;
  const s = Math.max(0.2, (width || 340) / pw);
  const rects = rectsFor(highlight, pageNo);
  const firstTop = rects[0] ? rects[0][1] : null;
  useEffect(() => {
    if (firstTop === null || !box.current?.parentElement) return;
    box.current.parentElement.scrollTo({ top: Math.max(0, firstTop * s - 60), behavior: 'smooth' });
  }, [firstTop, s, highlight?.key]);
  if (err) return <p className="mu">원문을 불러오지 못했습니다.</p>;
  return (
    <div ref={box} className="single">
      <div className="pg" style={{ width: pw * s, height: ph * s }}>
        {pdf && <PageCanvas pdf={pdf} pageNo={pageNo} scale={s} visible />}
        <Highlights rects={rects} scale={s} pulseKey={highlight?.key} />
      </div>
    </div>
  );
}
