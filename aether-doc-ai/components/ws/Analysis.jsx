'use client';
// F-10 3단 서브탭 [요약] [목차] [키워드] · F-11 키워드 칩
import Icon from '../Icon';
import { docsApi } from '@/lib/api';
import { askAbout, goToPage } from './actions';
import { LoadError, Skeleton, useLoad } from './ui';

const POINT_ICONS = ['lightbulb', 'insights', 'fact_check', 'flag'];

export function SubTabs({ value, onChange }) {
  const tabs = [
    ['summary', '요약', 'summarize'],
    ['toc', '목차', 'toc'],
    ['keywords', '키워드', 'sell'],
  ];
  return (
    <div className="seg sm" role="tablist" aria-label="분석 보기">
      {tabs.map(([k, l, ic]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          <Icon name={ic} size={18} />
          {l}
        </button>
      ))}
    </div>
  );
}

function Summary({ docId, mobile }) {
  const { data, error, loading, reload } = useLoad(() => docsApi.summary(docId), [docId]);
  if (loading) return <Skeleton lines={5} />;
  if (error) return <LoadError onRetry={reload} />;
  return (
    <div className="tab-anim">
      <div className="card pad sum">
        <span className="tag">
          <Icon name="auto_awesome" fill size={16} /> AI 요약
        </span>
        <p>{data.summary || '요약이 없어요.'}</p>
      </div>
      {!!data.points?.length && (
        <>
          <h3 className="sec-h sm">핵심 포인트</h3>
          <div className="points">
            {data.points.map((p, i) => (
              <div key={i} className="card point" style={{ '--i': i }}>
                <span className="p-ico">
                  <Icon name={POINT_ICONS[i % POINT_ICONS.length]} />
                </span>
                <div>
                  <b>{p.title}</b>
                  <p>{p.text}</p>
                  <button className="chip sm" onClick={() => goToPage(docId, p.page, mobile)} aria-label={`${p.page}페이지로 이동`}>
                    <Icon name="description" size={16} />
                    p.{p.page}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Toc({ docId, mobile }) {
  const { data, error, loading, reload } = useLoad(() => docsApi.toc(docId), [docId]);
  if (loading) return <Skeleton lines={6} />;
  if (error) return <LoadError onRetry={reload} />;
  if (!data.toc?.length)
    return (
      <div className="empty sm">
        <Icon name="toc" size={36} />
        <p>이 문서에서는 장·절 제목을 찾지 못했어요.</p>
      </div>
    );
  return (
    <ul className="card toc tab-anim" aria-label="목차">
      {data.toc.map((t, i) => (
        <li key={i}>
          <button className={`row lv${Math.min(t.level, 4)}`} style={{ paddingLeft: 14 + (t.level - 1) * 18 }} onClick={() => goToPage(docId, t.page, mobile)}>
            <span className="row-t">{t.title}</span>
            <span className="mu">p.{t.page}</span>
            <Icon name="chevron_right" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Keywords({ docId }) {
  const { data, error, loading, reload } = useLoad(() => docsApi.keywords(docId), [docId]);
  if (loading) return <Skeleton lines={3} />;
  if (error) return <LoadError onRetry={reload} />;
  return (
    <div className="tab-anim">
      <p className="hint">
        <Icon name="touch_app" size={18} /> 키워드를 누르면 AI에게 바로 질문해요.
      </p>
      <div className="chips">
        {(data.keywords || []).map(({ k, n }) => (
          <button key={k} className="chip kw" onClick={() => askAbout(docId, `이 문서에서 ${k}에 대해 설명해줘`)}>
            {k}
            <span className="cnt">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AnalysisBody({ docId, subtab, mobile }) {
  if (subtab === 'toc') return <Toc docId={docId} mobile={mobile} />;
  if (subtab === 'keywords') return <Keywords docId={docId} />;
  return <Summary docId={docId} mobile={mobile} />;
}
