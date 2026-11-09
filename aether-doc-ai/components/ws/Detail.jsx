'use client';
// 상세페이지: S-05 요약·키워드, S-06 목차, S-07 AI 대화, S-08 출처 바텀 시트, S-11 Split View
import { useEffect } from 'react';
import Icon from '../Icon';
import { docsApi } from '@/lib/api';
import { useApp } from '@/lib/store';
import { AnalysisBody, SubTabs } from './Analysis';
import Chat from './Chat';
import PdfViewer, { SinglePage } from './PdfViewer';
import { LoadError, Skeleton, useBreakpoint, useDocState, useLoad } from './ui';

function SourceSheet({ docId, meta }) {
  const ds = useDocState(docId);
  const patchDoc = useApp((s) => s.patchDoc);
  const h = ds.sheet;
  useEffect(() => {
    if (!h) return;
    const onKey = (e) => e.key === 'Escape' && patchDoc(docId, { sheet: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h, docId, patchDoc]);
  if (!h) return null;
  const close = () => patchDoc(docId, { sheet: null });
  return (
    <>
      <div className="ov dim" onClick={close} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`출처 원문 ${h.page}페이지`}>
        <i className="hnd" aria-hidden="true" />
        <div className="sh">
          <b>
            <Icon name="picture_as_pdf" /> p.{h.page}
          </b>
          <button className="ib" onClick={close} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="sb">
          <SinglePage url={meta.pdf_url} pageNo={h.page} pageSize={meta.page_sizes?.[h.page - 1]} highlight={h} />
        </div>
        <div className="sheet-foot">
          <button
            className="btn full"
            onClick={() => patchDoc(docId, { sheet: null, panel: 'pdf', highlight: { ...h, key: Date.now() } })}
          >
            원문에서 이어 보기
          </button>
        </div>
      </div>
    </>
  );
}

function TopBar({ meta, onBack }) {
  return (
    <header className="top">
      <button className="ib" onClick={onBack} aria-label="뒤로가기">
        <Icon name="arrow_back" />
      </button>
      <div className="tt-wrap">
        <div className="tt">{meta?.title || '문서'}</div>
        {meta && (
          <small className="mu">
            {meta.page_count}페이지{meta.two_column ? ' · 2단 문서' : ''}
          </small>
        )}
      </div>
    </header>
  );
}

// 오른쪽 패널 (태블릿 50%, 데스크톱 380px): [AI 대화] [요약] [목차] [키워드]
function SidePanel({ docId }) {
  const ds = useDocState(docId);
  const patchDoc = useApp((s) => s.patchDoc);
  const tab = ds.panel === 'chat' ? 'chat' : ds.subtab;
  const tabs = [
    ['chat', 'AI 대화', 'forum'],
    ['summary', '요약', 'summarize'],
    ['toc', '목차', 'toc'],
    ['keywords', '키워드', 'sell'],
  ];
  const set = (k) => patchDoc(docId, k === 'chat' ? { panel: 'chat' } : { panel: 'analysis', subtab: k });
  return (
    <section className="side" aria-label="AI 대화와 분석">
      <div className="seg" role="tablist">
        {tabs.map(([k, l, ic]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set(k)}>
            <Icon name={ic} size={18} />
            {l}
          </button>
        ))}
      </div>
      <div className="side-body">
        {/* 대화는 탭을 바꿔도 사라지지 않게 숨김 처리만 한다 (입력 중 프롬프트 유지) */}
        <div className="pane-chat" hidden={tab !== 'chat'}>
          <Chat docId={docId} mobile={false} />
        </div>
        {tab !== 'chat' && (
          <div className="pane-an">
            <AnalysisBody docId={docId} subtab={tab} mobile={false} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function Detail({ docId }) {
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  const go = useApp((s) => s.go);
  const patchDoc = useApp((s) => s.patchDoc);
  const ds = useDocState(docId);
  const { data: meta, error, loading, reload } = useLoad(() => docsApi.get(docId), [docId]);

  // F-05-1: 상세 진입 도중 상태가 바뀌었으면 목록으로
  useEffect(() => {
    if (error && (error.code === 'analysis_in_progress' || error.code === 'analysis_failed' || error.code === 'not_found')) {
      useApp.getState().showToast(error.message, 'info');
      go('docs');
    }
  }, [error, go]);

  // 태블릿·데스크톱에는 [PDF] 탭이 따로 없다 (PDF가 항상 보임)
  useEffect(() => {
    if (!mobile && ds.panel === 'pdf') patchDoc(docId, { panel: 'analysis' });
    if (!mobile && ds.sheet) patchDoc(docId, { sheet: null });
  }, [mobile, ds.panel, ds.sheet, docId, patchDoc]);

  const back = () => go('docs');
  const viewer = meta ? <PdfViewer docId={docId} url={meta.pdf_url} pageSizes={meta.page_sizes} onReload={reload} /> : null;
  const body = loading ? (
    <div className="pad">
      <Skeleton lines={6} />
    </div>
  ) : error ? (
    <LoadError onRetry={reload} message={error.code === 'timeout' || error.code === 'network' ? '데이터를 불러오지 못했습니다.' : error.message} />
  ) : null;

  if (mobile) {
    const tabs = [
      ['analysis', '분석', 'insights'],
      ['chat', 'AI 대화', 'forum'],
      ['pdf', 'PDF', 'picture_as_pdf'],
    ];
    return (
      <div className="detail m">
        <TopBar meta={meta} onBack={back} />
        <div className="seg-wrap">
          <div className="seg" role="tablist" aria-label="문서 보기">
            {tabs.map(([k, l, ic]) => (
              <button key={k} role="tab" aria-selected={ds.panel === k} className={ds.panel === k ? 'on' : ''} onClick={() => patchDoc(docId, { panel: k })}>
                <Icon name={ic} size={20} />
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="m-body">
          {body || (
            <>
              {ds.panel === 'analysis' && (
                <div className="m-scroll">
                  <SubTabs value={ds.subtab} onChange={(k) => patchDoc(docId, { subtab: k })} />
                  <AnalysisBody docId={docId} subtab={ds.subtab} mobile />
                </div>
              )}
              <div className="pane-chat" hidden={ds.panel !== 'chat'}>
                <Chat docId={docId} mobile />
              </div>
              {ds.panel === 'pdf' && viewer}
            </>
          )}
        </div>
        {meta && <SourceSheet docId={docId} meta={meta} />}
      </div>
    );
  }

  return (
    <div className={`detail split ${bp}`}>
      {bp === 'tablet' && <TopBar meta={meta} onBack={back} />}
      {bp === 'desktop' && (
        <div className="detail-hd">
          <button className="ib" onClick={back} aria-label="뒤로가기">
            <Icon name="arrow_back" />
          </button>
          <b className="tt">{meta?.title}</b>
          {meta && <small className="mu">{meta.page_count}페이지</small>}
        </div>
      )}
      <div className="split-body">
        <section className="pdf-pane" aria-label="PDF 원문">
          {body || viewer}
        </section>
        <SidePanel docId={docId} />
      </div>
    </div>
  );
}
