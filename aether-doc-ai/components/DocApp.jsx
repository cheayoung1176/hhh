'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import ThemeToggle from './ThemeToggle';
import {
  ANALYSIS_STEPS,
  INITIAL_DOCS,
  KEYWORDS,
  PAGES,
  SAMPLE_FILE,
  SUGGESTIONS,
  SUMMARY,
  SUMMARY_POINTS,
  TOC,
  findAnswer,
  today,
} from '@/lib/data';

const MAX_BYTES = 50 * 1024 * 1024;
const WELCOME_KEY = 'aether_welcomed';

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const stepOf = (p) => Math.min(ANALYSIS_STEPS.length - 1, Math.floor((p || 0) / (100 / ANALYSIS_STEPS.length)));

/* ───────────── 작은 UI 조각 ───────────── */

function Status({ st }) {
  if (st === 'prog') return <span className="spin" role="img" aria-label="분석 중" />;
  if (st === 'ok')
    return (
      <span className="ico ok" role="img" aria-label="분석 완료">
        <Icon name="check_circle" fill />
      </span>
    );
  return (
    <span className="ico er" role="img" aria-label="분석 실패">
      <Icon name="error" fill />
    </span>
  );
}

function DocCard({ d, onOpen, index }) {
  const pct = Math.round(d.progress || 0);
  return (
    <button className={`card item st-${d.st}`} onClick={() => onOpen(d.id)} style={{ '--i': index }}>
      <span className="pdf">PDF</span>
      <span className="inf">
        <b>{d.name}</b>
        <small>
          {d.date} · {d.mb}MB{d.st === 'ok' && d.pages ? ` · ${d.pages}페이지` : ''}
        </small>
        {d.st === 'prog' && (
          <span className="prog" aria-live="polite">
            <span className="prog-track">
              <span className="prog-fill" style={{ width: `${pct}%` }} />
            </span>
            <small>
              {ANALYSIS_STEPS[stepOf(pct)]} 중 · {pct}%
            </small>
          </span>
        )}
        {d.st === 'fail' && <small className="er">분석 실패 · 눌러서 다시 시도</small>}
      </span>
      <Status st={d.st} />
    </button>
  );
}

function Skeleton({ lines = 4 }) {
  return (
    <div className="skel" aria-label="불러오는 중" role="status">
      <i className="sk h" />
      {Array.from({ length: lines }).map((_, i) => (
        <i key={i} className="sk" style={{ width: `${92 - i * 11}%` }} />
      ))}
      <div className="sk-row">
        <i className="sk box" />
        <i className="sk box" />
      </div>
    </div>
  );
}

function PageView({ n, hl }) {
  const p = PAGES[n - 1];
  if (!p) return null;
  return (
    <div className="page-anim" key={`${n}-${hl}`}>
      {hl && (
        <div className="cite">
          <b>
            <Icon name="format_ink_highlighter" size={18} /> 인용 위치 · 출처 p.{n}
          </b>
          <p>“…{p.k.slice(0, 44)}…”</p>
        </div>
      )}
      <article className="paper">
        <div className="fn">{SAMPLE_FILE}</div>
        <div className="sc">{p.sc}</div>
        <h2>{p.t}</h2>
        <p>{p.p}</p>
        <div className={`key ${hl ? 'on' : ''}`}>
          {hl ? <mark>{p.k}</mark> : p.k}
          {hl && <em>AI 답변 생성에 직접 사용된 핵심 근거 문장</em>}
        </div>
        {p.chart && (
          <>
            <div className="bars" role="img" aria-label="NPU 출하량 추이 막대그래프">
              {p.chart.map((v, i) => (
                <i key={i} style={{ height: `${(v / 590) * 100}%`, '--i': i }}>
                  <span>{v}</span>
                  <small>{2024 + i}</small>
                </i>
              ))}
            </div>
            <p className="cap">[도표 3-4] 글로벌 NPU 출하량 추이 (2024~2028F, 백만 대)</p>
          </>
        )}
        <div className="pf">
          <span>Tech Insights Research Group</span>
          <span>{n}</span>
        </div>
      </article>
    </div>
  );
}

/* ───────────── 메인 앱 ───────────── */

export default function DocApp() {
  const wide = useWide();
  const [docs, setDocs] = useState(INITIAL_DOCS);
  const [chats, setChats] = useState({});
  const [view, setView] = useState('home');
  const [docId, setDocId] = useState(1);
  const [lastId, setLastId] = useState(1);
  const [tab, setTab] = useState('an');
  const [sub, setSub] = useState('sum');
  const [sort, setSort] = useState('new');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(2);
  const [hl, setHl] = useState(false);
  const [sheet, setSheet] = useState(0);
  const [draft, setDraft] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const timers = useRef(new Set());
  const seq = useRef(4);
  const msgSeq = useRef(1);
  const streamingRef = useRef(false);
  const fileRef = useRef(null);
  const msgsRef = useRef(null);
  const dragDepth = useRef(0);

  /* 타이머 헬퍼: 언마운트 시 일괄 정리 */
  const every = useCallback((fn, ms) => {
    const id = setInterval(fn, ms);
    timers.current.add(id);
    return id;
  }, []);
  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);
  const clear = useCallback((id) => {
    clearInterval(id);
    timers.current.delete(id);
  }, []);

  const showToast = useCallback((msg, icon = 'info') => setToast({ msg, icon, key: Date.now() }), []);

  const startAnalysis = useCallback(
    (id, name, from = 0) => {
      let p = from;
      setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, st: 'prog', progress: p } : d)));
      const iv = every(() => {
        p = Math.min(100, p + 3 + Math.random() * 5);
        if (p >= 100) {
          clear(iv);
          setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, st: 'ok', progress: 100, pages: d.pages || 6 } : d)));
          showToast(`‘${name}’ 분석이 완료됐어요`, 'check_circle');
        } else {
          setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, progress: p } : d)));
        }
      }, 260);
    },
    [every, clear, showToast]
  );

  /* 최초 진입: 진행 중 문서 이어서 분석, 온보딩, ?demo=1 */
  useEffect(() => {
    const t = timers.current;
    const seed = INITIAL_DOCS.find((d) => d.st === 'prog');
    if (seed) startAnalysis(seed.id, seed.name, seed.progress);

    let welcomed = false;
    try {
      welcomed = localStorage.getItem(WELCOME_KEY) === '1';
    } catch (e) {}
    const demo = new URLSearchParams(window.location.search).get('demo') === '1';
    if (demo) {
      openDetail(1);
      try {
        localStorage.setItem(WELCOME_KEY, '1');
      } catch (e) {}
    } else if (!welcomed) {
      setWelcome(true);
    }
    return () => {
      t.forEach((id) => clearInterval(id));
      t.clear();
      streamingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 토스트 자동 닫기 */
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  /* ESC로 모달·시트 닫기 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (modal) setModal(null);
      else if (sheet) setSheet(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, sheet]);

  const effTab = wide && tab === 'pdf' ? 'an' : tab;
  const effSheet = wide ? 0 : sheet;
  const doc = docs.find((d) => d.id === docId);
  const msgs = chats[docId] || [];

  /* 새 메시지가 오면 아래로 스크롤 */
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, effTab, view]);

  function dismissWelcome() {
    setWelcome(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch (e) {}
  }

  function openDetail(id, nextTab = 'an') {
    setView('detail');
    setDocId(id);
    setLastId(id);
    setTab(nextTab);
    setSub('sum');
    setPage(2);
    setHl(false);
    setSheet(0);
    setDraft('');
    setLoading(true);
    later(() => setLoading(false), 700);
  }

  function openDoc(id) {
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    if (d.st === 'prog') return showToast(`분석 중이에요 (${Math.round(d.progress || 0)}%). 잠시만 기다려 주세요.`, 'hourglass_top');
    if (d.st === 'fail') {
      return setModal({
        icon: 'error',
        tone: 'er',
        title: '분석에 실패했습니다',
        msg: `‘${d.name}’을(를) 읽는 중 문제가 생겼어요. 다시 시도하거나 문서를 삭제할 수 있어요.`,
        actions: [
          { label: '문서 삭제', variant: 'sec', fn: () => confirmDelete(d) },
          { label: '재분석 시도', fn: () => { startAnalysis(d.id, d.name, 0); showToast('재분석을 시작했어요', 'refresh'); } },
        ],
      });
    }
    if (welcome) dismissWelcome();
    openDetail(id);
  }

  function confirmDelete(d) {
    setModal({
      icon: 'delete',
      tone: 'er',
      title: '문서를 삭제할까요?',
      msg: '삭제된 문서와 대화 기록은 복구할 수 없습니다.',
      actions: [
        { label: '취소', variant: 'sec' },
        {
          label: '삭제',
          variant: 'danger',
          fn: () => {
            setDocs((ds) => ds.filter((x) => x.id !== d.id));
            setChats((c) => {
              const n = { ...c };
              delete n[d.id];
              return n;
            });
            if (view === 'detail' && docId === d.id) setView('docs');
            showToast('문서를 삭제했어요', 'delete');
          },
        },
      ],
    });
  }

  function nav(v) {
    if (v === 'chat') {
      const d = docs.find((x) => x.id === lastId && x.st === 'ok') || docs.find((x) => x.st === 'ok');
      if (!d) return showToast('분석이 완료된 문서가 아직 없어요', 'info');
      setView('detail');
      setDocId(d.id);
      setLastId(d.id);
      setTab('chat');
      setSheet(0);
      setLoading(false);
      return;
    }
    setView(v);
  }

  function handleFile(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      return setModal({ icon: 'block', tone: 'er', title: 'PDF 파일만 업로드할 수 있어요', msg: '.pdf 형식의 파일을 선택해 주세요.', actions: [{ label: '확인' }] });
    }
    if (f.size > MAX_BYTES) {
      return setModal({ icon: 'folder_off', tone: 'er', title: '파일 용량 초과', msg: '파일 하나는 최대 50MB까지 업로드할 수 있어요.', actions: [{ label: '확인' }] });
    }
    const id = seq.current++;
    const d = { id, name: f.name, date: today(), mb: Math.max(0.1, +(f.size / 1048576).toFixed(1)), st: 'prog', progress: 0, up: true };
    setDocs((ds) => [...ds, d]);
    if (welcome) dismissWelcome();
    showToast('업로드 완료! 분석을 시작합니다', 'cloud_done');
    startAnalysis(id, f.name, 0);
  }

  function send(text) {
    const t = text.trim();
    if (!t) return;
    if (streamingRef.current) return showToast('답변을 작성하고 있어요. 잠시만요!', 'hourglass_top');
    const id = docId;
    const r = findAnswer(t);
    const uid = msgSeq.current++;
    const aid = msgSeq.current++;
    setChats((c) => ({ ...c, [id]: [...(c[id] || []), { id: uid, r: 'u', t }, { id: aid, r: 'a', t: '', s: [], busy: true }] }));
    streamingRef.current = true;
    setStreaming(true);
    let i = 0;
    later(() => {
      const iv = every(() => {
        i += 2;
        const done = i >= r.a.length;
        setChats((c) => ({
          ...c,
          [id]: (c[id] || []).map((m) =>
            m.id !== aid ? m : done ? { ...m, t: r.a, busy: false, s: r.s, none: r.none } : { ...m, t: r.a.slice(0, i) }
          ),
        }));
        if (done) {
          clear(iv);
          streamingRef.current = false;
          setStreaming(false);
        }
      }, 22);
    }, 450);
  }

  function ask() {
    if (!draft.trim()) return;
    const v = draft;
    setDraft('');
    send(v);
  }

  function askAbout(text) {
    setTab('chat');
    send(text);
  }

  function cite(n) {
    setPage(n);
    setHl(true);
    if (!wide) setSheet(n);
  }

  function goPage(n, keepHl = false) {
    setPage(n);
    setHl(keepHl);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('답변을 복사했어요', 'content_copy');
    } catch (e) {
      showToast('복사하지 못했어요', 'error');
    }
  }

  /* 드래그 앤 드롭 업로드 */
  const dragProps =
    view === 'detail'
      ? {}
      : {
          onDragEnter: (e) => {
            if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
            e.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          },
          onDragOver: (e) => {
            if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
          },
          onDragLeave: () => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          },
          onDrop: (e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            handleFile(e.dataTransfer?.files?.[0]);
          },
        };

  /* 문서 목록 */
  const visibleDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    let d = docs.filter((x) => x.name.toLowerCase().includes(q));
    if (view === 'home') return [...d].sort((a, b) => b.id - a.id).slice(0, 3);
    const cmp = sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ko') : sort === 'size' ? (a, b) => b.mb - a.mb : (a, b) => b.id - a.id;
    return [...d].sort(cmp);
  }, [docs, query, sort, view]);

  const counts = useMemo(
    () => ({ all: docs.length, ok: docs.filter((d) => d.st === 'ok').length, prog: docs.filter((d) => d.st === 'prog').length }),
    [docs]
  );

  /* ───────────── 렌더 함수들 ───────────── */

  const renderList = () => {
    const home = view === 'home';
    return (
      <>
        <header className="hd">
          <Link href="/" className="brand" aria-label="소개 페이지로">
            <span className="logo">
              <Icon name="description" fill />
            </span>
            <span className="brand-t">{home ? 'Aether Doc AI' : '내 문서'}</span>
          </Link>
          <div className="hd-r">
            {!home && (
              <label className="sel">
                <span className="sr">정렬</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                  <option value="new">최신순</option>
                  <option value="name">이름순</option>
                  <option value="size">용량순</option>
                </select>
              </label>
            )}
            <ThemeToggle />
          </div>
        </header>

        <div className="scroll view-anim" key={view}>
          {home && (
            <>
              <p className="greet">
                오늘은 어떤 문서를
                <br />
                <b>먼저 물어볼까요?</b>
              </p>

              {welcome && (
                <div className="welcome">
                  <button className="ib x" onClick={dismissWelcome} aria-label="안내 닫기">
                    <Icon name="close" />
                  </button>
                  <span className="w-ico">
                    <Icon name="waving_hand" fill />
                  </span>
                  <b>처음 오셨나요?</b>
                  <p>샘플 보고서로 요약 확인 → 질문 → 출처 확인까지 30초 만에 둘러보세요.</p>
                  <button className="btn light sm" onClick={() => openDoc(1)}>
                    샘플 문서 열기 <Icon name="arrow_forward" />
                  </button>
                </div>
              )}

              <div className="stats">
                <div>
                  <b>{counts.all}</b>
                  <small>전체 문서</small>
                </div>
                <div>
                  <b className="ok">{counts.ok}</b>
                  <small>분석 완료</small>
                </div>
                <div>
                  <b className="info">{counts.prog}</b>
                  <small>분석 중</small>
                </div>
              </div>
            </>
          )}

          <div className="srch">
            <Icon name="search" />
            <input placeholder="문서 이름으로 검색" aria-label="문서 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button className="ib sm" onClick={() => setQuery('')} aria-label="검색어 지우기">
                <Icon name="close" />
              </button>
            )}
          </div>

          {home && (
            <div className="sec-row">
              <h2 className="sec-h">최근 분석 문서</h2>
              <button className="link" onClick={() => setView('docs')}>
                전체 보기 <Icon name="chevron_right" />
              </button>
            </div>
          )}

          {visibleDocs.length ? (
            <div className="cards">
              {visibleDocs.map((d, i) => (
                <DocCard key={d.id} d={d} index={i} onOpen={openDoc} />
              ))}
            </div>
          ) : query ? (
            <div className="empty">
              <Icon name="search_off" size={44} />
              <b>‘{query}’와(과) 일치하는 문서가 없어요</b>
              <p>다른 검색어를 입력하거나 검색어를 지워 보세요.</p>
              <button className="btn sec sm" onClick={() => setQuery('')}>
                검색어 지우기
              </button>
            </div>
          ) : (
            <div className="empty">
              <Icon name="note_stack" size={44} />
              <b>아직 문서가 없어요</b>
              <p>첫 PDF를 올리면 요약과 키워드를 바로 정리해 드려요.</p>
            </div>
          )}

          <button className="drop" onClick={() => fileRef.current?.click()}>
            <Icon name="upload_file" size={30} />
            <span>
              <b>PDF를 끌어다 놓거나 눌러서 업로드</b>
              <small>최대 50MB · .pdf 형식</small>
            </span>
          </button>

          <p className="foot-note">
            <Icon name="info" size={16} /> 시연 버전이라 업로드한 문서도 샘플 보고서의 분석 결과로 보여 드려요.
          </p>
        </div>

        <button className="fab" onClick={() => fileRef.current?.click()} aria-label="PDF 업로드" title="PDF 업로드">
          <Icon name="add" size={28} />
        </button>
      </>
    );
  };

  const renderAnalysis = () => (
    <div className="tab-anim" key={`an-${sub}`}>
      <div className="seg sm" role="tablist" aria-label="분석 보기">
        {[
          ['sum', '요약', 'summarize'],
          ['toc', '목차', 'toc'],
          ['kw', '키워드', 'sell'],
        ].map(([k, l, ic]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>
            <Icon name={ic} size={18} />
            {l}
          </button>
        ))}
      </div>

      {sub === 'sum' && (
        <>
          <div className="card pad sum">
            <span className="tag">
              <Icon name="auto_awesome" fill size={16} /> AI 요약
            </span>
            <p>{SUMMARY}</p>
          </div>
          <h3 className="sec-h sm">핵심 포인트</h3>
          <div className="points">
            {SUMMARY_POINTS.map((p, i) => (
              <div key={p.title} className="card point" style={{ '--i': i }}>
                <span className="p-ico">
                  <Icon name={p.icon} />
                </span>
                <div>
                  <b>{p.title}</b>
                  <p>{p.text}</p>
                  <button className="chip sm" onClick={() => cite(p.page)} aria-label={`출처 ${p.page}페이지 보기`}>
                    <Icon name="description" size={16} />
                    p.{p.page}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {sub === 'toc' && (
        <div className="card toc">
          {TOC.map(([t, p], i) => (
            <button
              key={t}
              className={`row ${page === p ? 'cur-row' : ''}`}
              onClick={() => {
                goPage(p);
                if (!wide) setTab('pdf');
              }}
            >
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <span className="row-t">{t}</span>
              <span className="mu">p.{p}</span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </div>
      )}

      {sub === 'kw' && (
        <>
          <p className="hint">
            <Icon name="touch_app" size={18} /> 키워드를 누르면 AI에게 바로 질문해요.
          </p>
          <div className="chips">
            {KEYWORDS.map(({ k, n }) => (
              <button key={k} className="chip kw" onClick={() => askAbout(`이 문서에서 ${k}에 대해 설명해줘`)}>
                {k}
                <span className="cnt">{n}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const renderChat = () => (
    <div className="chat">
      <div className="msgs" ref={msgsRef} aria-live="polite">
        {msgs.length === 0 ? (
          <div className="hello">
            <span className="hello-ico">
              <Icon name="auto_awesome" fill size={30} />
            </span>
            <b>문서에 대해 무엇이든 물어보세요</b>
            <p>답변마다 근거가 된 페이지를 함께 알려 드려요.</p>
            <div className="chips center">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m) =>
            m.r === 'u' ? (
              <div key={m.id} className="u msg-anim">
                {m.t}
              </div>
            ) : (
              <div key={m.id} className="a msg-anim">
                <span className="av">
                  <Icon name="auto_awesome" fill size={18} />
                </span>
                <div className="a-body">
                  <div className="bub">
                    {m.busy && !m.t ? (
                      <span className="typing" aria-label="답변 작성 중">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <>
                        <span>{m.t}</span>
                        {m.busy && <i className="cur" />}
                      </>
                    )}
                  </div>
                  {!m.busy && (
                    <div className="src">
                      {m.s.map((n) => (
                        <button key={n} className="chip sm" onClick={() => cite(n)} aria-label={`출처 ${n}페이지 보기`}>
                          <Icon name="description" size={16} />
                          p.{n}
                        </button>
                      ))}
                      <button className="ib sm" onClick={() => copy(m.t)} aria-label="답변 복사" title="복사">
                        <Icon name="content_copy" size={18} />
                      </button>
                    </div>
                  )}
                  {m.none && !m.busy && (
                    <p className="warn">
                      <Icon name="report" size={16} /> 문서 내 명확한 근거를 찾지 못했습니다.
                    </p>
                  )}
                </div>
              </div>
            )
          )
        )}
      </div>
      <form
        className="inp"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input maxLength={300} placeholder="질문을 입력하세요" aria-label="질문 입력" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="send" type="submit" disabled={!draft.trim() || streaming} aria-label="전송">
          {streaming ? <span className="spin light" /> : <Icon name="arrow_upward" />}
        </button>
      </form>
    </div>
  );

  const renderPdf = () => (
    <>
      <div className="pager">
        <button className="ib" onClick={() => goPage(page - 1)} disabled={page < 2} aria-label="이전 페이지">
          <Icon name="chevron_left" />
        </button>
        <b>
          {page} <span className="mu">/ {PAGES.length}</span>
        </b>
        <button className="ib" onClick={() => goPage(page + 1)} disabled={page >= PAGES.length} aria-label="다음 페이지">
          <Icon name="chevron_right" />
        </button>
      </div>
      <PageView n={page} hl={hl} />
      <div className="bar">
        {!wide && (
          <button className="btn sec" onClick={() => setTab('chat')}>
            <Icon name="forum" /> 대화로 돌아가기
          </button>
        )}
        <button className="btn" onClick={() => askAbout(`p.${page}의 내용을 설명해줘`)}>
          <Icon name="help" /> 이 페이지 질문하기
        </button>
      </div>
    </>
  );

  const renderTabs = (tabs) => (
    <div className="seg" role="tablist" aria-label="문서 보기">
      {tabs.map(([k, l, ic]) => (
        <button key={k} role="tab" aria-selected={effTab === k} className={effTab === k ? 'on' : ''} onClick={() => setTab(k)}>
          <Icon name={ic} size={20} />
          {l}
        </button>
      ))}
    </div>
  );

  const renderDetail = () => {
    const tabs = [['an', '분석', 'insights'], ['chat', 'AI 대화', 'forum'], ...(wide ? [] : [['pdf', '원문', 'picture_as_pdf']])];
    const side = loading ? <Skeleton /> : effTab === 'an' ? renderAnalysis() : effTab === 'chat' ? renderChat() : renderPdf();
    return (
      <>
        <header className="top">
          <button className="ib" onClick={() => setView('docs')} aria-label="뒤로">
            <Icon name="arrow_back" />
          </button>
          <div className="tt-wrap">
            <div className="tt">{doc?.name}</div>
            <small className="mu">
              {doc?.pages || 6}페이지 · {doc?.mb}MB · 분석 완료
            </small>
          </div>
          <ThemeToggle />
        </header>
        {doc?.up && (
          <p className="note">
            <Icon name="info" size={16} /> 시연 버전이라 업로드한 문서도 샘플 보고서의 분석 결과로 보여 드려요.
          </p>
        )}
        {!wide && <div className="seg-wrap">{renderTabs(tabs)}</div>}
        <div className="main">
          {wide && <section className="pane pdf-pane">{loading ? <Skeleton lines={6} /> : renderPdf()}</section>}
          <section className={`pane side ${effTab === 'chat' && !loading ? 'is-chat' : ''}`}>
            {wide && renderTabs(tabs)}
            <div className="side-body view-anim" key={`${effTab}-${loading}`}>
              {side}
            </div>
          </section>
        </div>
        {effSheet ? (
          <>
            <div className="ov" onClick={() => setSheet(0)} />
            <div className="sheet" role="dialog" aria-modal="true" aria-label={`출처 원문 ${effSheet}페이지`}>
              <i className="hnd" />
              <div className="sh">
                <b>
                  <Icon name="picture_as_pdf" /> 출처 p.{effSheet}
                </b>
                <button className="ib" onClick={() => setSheet(0)} aria-label="닫기">
                  <Icon name="close" />
                </button>
              </div>
              <div className="sb">
                <PageView n={effSheet} hl />
                <button
                  className="btn full"
                  onClick={() => {
                    setSheet(0);
                    setTab('pdf');
                  }}
                >
                  원문에서 이어 보기
                </button>
              </div>
            </div>
          </>
        ) : null}
      </>
    );
  };

  const appClass = view === 'detail' ? (wide ? 'app wide' : 'app') : wide ? 'app list-wide' : 'app';

  return (
    <div className={appClass} {...dragProps}>
      {view === 'detail' ? renderDetail() : renderList()}

      {view !== 'detail' && (
        <nav className="nav" aria-label="하단 메뉴">
          {[
            ['home', '홈', 'home'],
            ['docs', '내 문서', 'description'],
            ['chat', 'AI 대화', 'forum'],
          ].map(([k, l, ic]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => nav(k)} aria-current={view === k ? 'page' : undefined}>
              <Icon name={ic} fill={view === k} />
              {l}
            </button>
          ))}
        </nav>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          handleFile(f);
        }}
      />

      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div>
            <Icon name="cloud_upload" size={56} />
            <b>여기에 PDF를 놓으세요</b>
            <small>최대 50MB</small>
          </div>
        </div>
      )}

      {modal && (
        <div className="mo" onClick={() => setModal(null)}>
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" onClick={(e) => e.stopPropagation()}>
            {modal.icon && (
              <span className={`dlg-ico ${modal.tone || ''}`}>
                <Icon name={modal.icon} fill />
              </span>
            )}
            <h3 id="dlg-t">{modal.title}</h3>
            <p>{modal.msg}</p>
            <div className="acts">
              {modal.actions.map((a, i) => (
                <button
                  key={a.label}
                  className={`btn ${a.variant || ''}`}
                  autoFocus={i === modal.actions.length - 1}
                  onClick={() => {
                    setModal(null);
                    a.fn?.();
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status" key={toast.key}>
          <Icon name={toast.icon} fill size={20} />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
