'use client';
// S-07 AI 대화 (F-08 스트리밍·맥락, F-09 출처 칩, F-11 자동 질의, F-12 히스토리 서랍)
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { ApiError, chatApi, hasBadInput, INVALID_INPUT_MSG } from '@/lib/api';
import { useApp } from '@/lib/store';
import { showSource } from './actions';
import { formatDate, formatTime, LoadError, Skeleton, useDocState, useLoad } from './ui';

const SUGGESTIONS = ['이 문서의 핵심 내용은?', '결론을 요약해 줘', '중요한 수치를 알려줘'];
const stripCites = (t) => t.replace(/\s*\[\d{1,2}\](?:\s*[,，、]?\s*\[\d{1,2}\])*/g, '').replace(/\[\d?$/, '');
let keySeq = 0;
const newKey = () => `m${Date.now()}-${keySeq++}`;

function Bubble({ m, docId, mobile, readOnly }) {
  if (m.role === 'user')
    return (
      <div className="msg u-row msg-anim">
        <div className="u">{m.content}</div>
        <time className="tm">{formatTime(m.time)}</time>
      </div>
    );
  return (
    <div className="msg a msg-anim">
      <span className="av" aria-hidden="true">
        <Icon name="auto_awesome" fill size={18} />
      </span>
      <div className="a-body">
        <div className="bub">
          {m.streaming && !m.content ? (
            <span className="typing" aria-label="답변 작성 중">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <>
              <span>{m.streaming ? stripCites(m.content) : m.content}</span>
              {m.streaming && <i className="cur" />}
            </>
          )}
        </div>
        {!m.streaming && (
          <div className="src">
            {(m.sources || []).map((s, i) => (
              <button key={i} className="chip sm" onClick={() => showSource(docId, s, mobile)} aria-label={`출처 ${s.page_num}페이지 보기`}>
                <Icon name="description" size={16} />
                p.{s.page_num}
              </button>
            ))}
            <time className="tm">{formatTime(m.time)}</time>
          </div>
        )}
        {m.none && !m.streaming && (
          <p className="warn">
            <Icon name="report" size={16} /> 문서 내 명확한 근거를 찾지 못했습니다.
          </p>
        )}
        {m.interrupted && (
          <p className="warn">
            <Icon name="wifi_off" size={16} /> 연결이 일시 중단되었습니다
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- F-12 히스토리 서랍
function HistoryDrawer({ docId, onClose, onOpen, currentId }) {
  const { data, error, loading, reload } = useLoad(() => chatApi.sessions(docId), [docId]);
  return (
    <>
      <div className="ov" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="대화 기록">
        <div className="drawer-hd">
          <b>
            <Icon name="history" /> 대화 기록
          </b>
          <button className="ib" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          {loading && <Skeleton lines={4} card={false} />}
          {error && <LoadError onRetry={reload} />}
          {data && !data.sessions.length && <p className="mu pad">아직 저장된 대화가 없어요.</p>}
          {data?.sessions.map((s) => (
            <button key={s.session_id} className={`row ${s.session_id === currentId ? 'cur-row' : ''}`} onClick={() => onOpen(s)}>
              <Icon name="forum" />
              <span className="row-t">
                {s.title || '제목 없는 대화'}
                <small className="mu">
                  {formatDate(s.updated_at)} {formatTime(s.updated_at)}
                </small>
              </span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

function ReadOnlySession({ session, onBack, docId, mobile }) {
  const { data, error, loading, reload } = useLoad(() => chatApi.messages(session.session_id), [session.session_id]);
  return (
    <div className="chat">
      <div className="ro-bar">
        <button className="link" onClick={onBack}>
          <Icon name="arrow_back" size={18} /> 현재 대화로
        </button>
        <span className="ro-tag">
          <Icon name="visibility" size={16} /> 읽기 전용
        </span>
      </div>
      <div className="msgs">
        {loading && <Skeleton lines={5} card={false} />}
        {error && <LoadError onRetry={reload} />}
        {data?.messages.map((m) => (
          <Bubble key={m.message_id} m={{ ...m, time: m.created_at }} docId={docId} mobile={mobile} readOnly />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 대화 패널
export default function Chat({ docId, mobile }) {
  const ds = useDocState(docId);
  const patchDoc = useApp((s) => s.patchDoc);
  const showToast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [inputErr, setInputErr] = useState('');
  const msgsRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ds.messages, viewing]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // F-11: 키워드 칩 → 자동 질의 (세션이 없으면 바로 만든다)
  const pendingKey = ds.pendingAsk?.key;
  useEffect(() => {
    if (!ds.pendingAsk || busy) return;
    const text = ds.pendingAsk.text;
    patchDoc(docId, { pendingAsk: null });
    setViewing(null);
    send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const setMessages = (fn) => patchDoc(docId, (cur) => ({ messages: fn(cur.messages) }));
  const updateMsg = (key, patch) => setMessages((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  async function ensureSession() {
    const cur = useApp.getState().docState[docId]?.sessionId;
    if (cur) return cur;
    const s = await chatApi.create(docId);
    patchDoc(docId, { sessionId: s.session_id });
    return s.session_id;
  }

  async function send(raw) {
    const text = (raw ?? ds.draft).trim();
    if (!text || busy) return;
    if (hasBadInput(text)) return setInputErr(INVALID_INPUT_MSG); // F-02-2
    setInputErr('');
    if (raw === undefined) patchDoc(docId, { draft: '' });
    const uk = newKey();
    const ak = newKey();
    setMessages((ms) => [...ms, { key: uk, role: 'user', content: text, time: new Date().toISOString() }, { key: ak, role: 'assistant', content: '', streaming: true, time: new Date().toISOString() }]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let got = '';
    try {
      const sid = await ensureSession();
      for await (const ev of chatApi.ask(sid, text, ctrl.signal)) {
        if (!ev.is_final) {
          got += ev.token;
          updateMsg(ak, { content: got });
        } else {
          updateMsg(ak, { content: ev.content ?? stripCites(got), sources: ev.sources || [], none: !!ev.none, streaming: false, interrupted: !!ev.interrupted, time: new Date().toISOString() });
          if (ev.interrupted) showToast(ev.error?.message || '연결이 일시 중단되었습니다', 'wifi_off', 'er');
          got = null;
        }
      }
      if (got !== null) updateMsg(ak, { content: stripCites(got), streaming: false, interrupted: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stream_broken') {
        // F-08: 받은 텍스트는 보존하고 알림
        updateMsg(ak, { content: stripCites(got || ''), streaming: false, interrupted: true });
        showToast('연결이 일시 중단되었습니다', 'wifi_off', 'er');
      } else {
        setMessages((ms) => ms.filter((m) => m.key !== ak));
        if (e.code === 'invalid_input') setInputErr(e.message);
        else showToast(e.message || '질문을 보내지 못했어요.', 'error', 'er');
        if (e.code === 'not_found') patchDoc(docId, { sessionId: null });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function newChat() {
    setMenu(false);
    setViewing(null);
    patchDoc(docId, { sessionId: null, messages: [] });
  }

  if (viewing) return <ReadOnlySession session={viewing} docId={docId} mobile={mobile} onBack={() => setViewing(null)} />;

  return (
    <div className="chat">
      <div className="chat-hd">
        <b>AI 대화</b>
        <span className="sp" />
        <button className="ib sm" onClick={() => setDrawer(true)} aria-label="대화 기록 열기" title="대화 기록">
          <Icon name="history" />
        </button>
      </div>
      <div className="msgs" ref={msgsRef} aria-live="polite">
        {ds.messages.length === 0 ? (
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
          ds.messages.map((m) => <Bubble key={m.key} m={m} docId={docId} mobile={mobile} />)
        )}
      </div>
      {inputErr && (
        <p className="field-err in-chat" role="alert">
          <Icon name="warning" size={16} /> {inputErr}
        </p>
      )}
      <form
        className="inp"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="plus-wrap">
          <button type="button" className="ib plus" aria-label="대화 보조 메뉴" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="add" />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={newChat}>
                <Icon name="add_comment" /> 새 대화 시작
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setDrawer(true);
                }}
              >
                <Icon name="history" /> 대화 기록 보기
              </button>
            </div>
          )}
        </div>
        <input
          maxLength={500}
          placeholder="질문을 입력하세요"
          aria-label="질문 입력"
          aria-invalid={!!inputErr}
          value={ds.draft}
          onChange={(e) => {
            patchDoc(docId, { draft: e.target.value });
            setInputErr('');
          }}
        />
        <button className="send" type="submit" disabled={!ds.draft.trim() || busy} aria-label="전송">
          {busy ? <span className="spin light" /> : <Icon name="arrow_upward" />}
        </button>
      </form>
      {drawer && (
        <HistoryDrawer
          docId={docId}
          currentId={ds.sessionId}
          onClose={() => setDrawer(false)}
          onOpen={(s) => {
            setDrawer(false);
            if (s.session_id === ds.sessionId) return setViewing(null);
            setViewing(s);
          }}
        />
      )}
    </div>
  );
}
