'use client';
// 문서 관련 동작 (F-03 ~ F-06-1)
import { useEffect, useRef } from 'react';
import { ApiError, docsApi, hasBadInput, INVALID_INPUT_MSG } from '@/lib/api';
import { useApp } from '@/lib/store';

const MAX_BYTES = 50 * 1024 * 1024;
const st = () => useApp.getState();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errToast(e) {
  st().showToast(e instanceof ApiError ? e.message : '요청을 처리하지 못했어요.', 'error', 'er');
}

// ---------------------------------------------------------------- 목록 (F-05, F-06)
export async function loadDocs() {
  const { sort, setDocsState, setDocs, docs } = st();
  if (!docs.length) setDocsState('loading');
  try {
    const r = await docsApi.list(sort);
    setDocs(r.documents);
  } catch (e) {
    setDocsState('error');
    if (e.code !== 'unauthorized') errToast(e);
  }
}

export function useDocsLoader() {
  const authState = useApp((s) => s.authState);
  const sort = useApp((s) => s.sort);
  useEffect(() => {
    if (authState === 'in') loadDocs();
  }, [authState, sort]);
}

// ---------------------------------------------------------------- F-05 상태 실시간 (SSE)
// 통신이 끊기면 마지막 상태를 그대로 두고, 다시 연결되면 최신 상태로 갱신한다.
export function useStatusWatch() {
  const docs = useApp((s) => s.docs);
  const watching = useRef(new Map());

  useEffect(() => {
    const ids = new Set(docs.filter((d) => d.status === 'progress').map((d) => d.doc_id));
    for (const id of ids) if (!watching.current.has(id)) watch(id);
    for (const [id, ctrl] of watching.current) {
      if (!ids.has(id)) {
        ctrl.abort();
        watching.current.delete(id);
      }
    }
  }, [docs]);

  useEffect(() => {
    const map = watching.current;
    return () => {
      for (const c of map.values()) c.abort();
      map.clear();
    };
  }, []);

  function watch(id) {
    const ctrl = new AbortController();
    watching.current.set(id, ctrl);
    (async () => {
      let attempt = 0;
      while (!ctrl.signal.aborted) {
        try {
          for await (const ev of docsApi.events(id, ctrl.signal)) {
            attempt = 0;
            if (ev.status === 'deleted') {
              st().removeDoc(id);
              return;
            }
            const prev = st().docs.find((d) => d.doc_id === id);
            st().upsertDoc(ev);
            if (prev?.status === 'progress' && ev.status === 'success') st().showToast(`‘${ev.title}’ 분석이 완료됐어요`, 'check_circle', 'ok');
            if (prev?.status === 'progress' && ev.status === 'fail') st().showToast(`‘${ev.title}’ 분석에 실패했어요`, 'error', 'er');
            if (ev.status !== 'progress') return;
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            st().removeDoc(id);
            return;
          }
        }
        if (ctrl.signal.aborted) return;
        attempt += 1;
        await sleep(Math.min(15000, 1000 * 2 ** attempt)); // 다시 연결
      }
    })();
  }
}

// ---------------------------------------------------------------- F-03 업로드 · F-04 암호 PDF
export async function uploadFile(file) {
  const { showToast, openModal, upsertDoc } = st();
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    return openModal({ icon: 'block', tone: 'er', title: 'PDF 파일만 업로드할 수 있습니다', msg: '.pdf 형식의 파일을 선택해 주세요.', actions: [{ label: '확인' }] });
  }
  if (file.size > MAX_BYTES) {
    return openModal({ icon: 'folder_off', tone: 'er', title: '파일 용량을 초과했습니다', msg: '파일 하나는 최대 50MB까지 업로드할 수 있습니다.', actions: [{ label: '확인' }] });
  }
  showToast('업로드하고 있어요…', 'cloud_upload');
  try {
    const doc = await docsApi.upload(file);
    upsertDoc(doc);
    showToast('업로드 완료! 분석을 시작합니다', 'cloud_done', 'ok');
  } catch (e) {
    if (e.code === 'encrypted_pdf') {
      // [확인] 을 누르면 화면이 들고 있던 파일 참조도 버린다. 서버는 저장하지 않고 이미 파기했다.
      openModal({ icon: 'lock', tone: 'er', title: e.message, msg: '암호를 해제한 뒤 다시 업로드해 주세요.', actions: [{ label: '확인' }] });
    } else if (e.code === 'not_pdf' || e.code === 'too_large' || e.code === 'invalid_input') {
      openModal({ icon: 'block', tone: 'er', title: e.message, actions: [{ label: '확인' }] });
    } else {
      errToast(e);
    }
  }
}

// ---------------------------------------------------------------- F-05-1 상태별 접근 제어
export function openDoc(doc) {
  const { showToast, openModal, go } = st();
  if (doc.status === 'progress') return showToast('문서를 분석하고 있어요. 잠시만 기다려 주세요.', 'hourglass_top');
  if (doc.status === 'fail') {
    return openModal({
      icon: 'error',
      tone: 'er',
      title: '분석에 실패했습니다',
      msg: doc.error_message || '문서를 분석하지 못했어요.',
      actions: [
        { label: '문서 삭제', variant: 'sec', fn: () => confirmDelete(doc) },
        ...(doc.error_code === 'encrypted_pdf' ? [] : [{ label: '재분석 시도', fn: () => reanalyze(doc) }]),
      ],
    });
  }
  go('detail', doc.doc_id);
}

export async function reanalyze(doc) {
  try {
    const d = await docsApi.reanalyze(doc.doc_id);
    st().upsertDoc(d);
    st().showToast('재분석을 시작했어요', 'refresh');
  } catch (e) {
    errToast(e);
  }
}

// ---------------------------------------------------------------- F-06-1 이름변경 · 삭제 (2차 확인 필수)
export function confirmDelete(doc) {
  st().openModal({
    icon: 'delete',
    tone: 'er',
    title: `‘${doc.title}’을(를) 삭제할까요?`,
    msg: '삭제된 데이터는 복구할 수 없습니다.',
    actions: [
      { label: '취소', variant: 'sec' },
      {
        label: '삭제',
        variant: 'danger',
        fn: async () => {
          try {
            await docsApi.remove(doc.doc_id);
            const { view, docId, go, removeDoc, showToast } = st();
            removeDoc(doc.doc_id);
            if (view === 'detail' && docId === doc.doc_id) go('docs');
            showToast('문서를 삭제했어요', 'delete');
          } catch (e) {
            errToast(e);
          }
        },
      },
    ],
  });
  return true; // 새 모달을 열었으니 지금 모달 닫기 동작은 건너뛴다
}

export function renameDoc(doc) {
  st().openModal({
    icon: 'edit',
    title: '이름 변경',
    input: { label: '새 문서 이름', value: doc.title, maxLength: 100 },
    actions: [
      { label: '취소', variant: 'sec' },
      {
        label: '변경',
        fn: async (value) => {
          const v = (value || '').trim();
          if (!v) return { error: '이름을 입력해 주세요.' };
          if (hasBadInput(v)) return { error: INVALID_INPUT_MSG }; // F-02-2: 입력 필드 하단 경고
          try {
            const d = await docsApi.rename(doc.doc_id, v);
            st().upsertDoc(d);
            st().showToast('이름을 바꿨어요', 'edit');
          } catch (e) {
            if (e.code === 'invalid_input' || e.code === 'bad_title') return { error: e.message };
            errToast(e);
          }
        },
      },
    ],
  });
}

// ---------------------------------------------------------------- 대화 진입 (하단 탭 [AI 대화])
export function openChat() {
  const { docs, go, patchDoc, showToast, docId } = st();
  const target = docs.find((d) => d.doc_id === docId && d.status === 'success') || docs.find((d) => d.status === 'success');
  if (!target) return showToast('분석이 완료된 문서가 아직 없어요', 'info');
  patchDoc(target.doc_id, { panel: 'chat' });
  go('detail', target.doc_id);
}

// F-11 키워드 칩: 질의를 만들어 대화로 보낸다 (대화 패널이 받아서 전송)
export function askAbout(docId, text) {
  st().patchDoc(docId, { panel: 'chat', pendingAsk: { text, key: Date.now() } });
}

// ---------------------------------------------------------------- F-09 출처 확인 · 목차 이동
// 모바일: 바텀 시트(60%), 태블릿·데스크톱: 메인 PDF 뷰어가 해당 위치로 스크롤하고 하이라이트
export function showSource(docId, src, mobile) {
  const same = (src.highlights || []).filter((h) => h.page === src.page_num).map((h) => h.rect);
  const rects = same.length ? same : src.rect ? [src.rect] : [];
  const highlight = { page: src.page_num, rects, key: Date.now() };
  st().patchDoc(docId, mobile ? { sheet: highlight, highlight } : { highlight });
}

export function goToPage(docId, page, mobile) {
  st().patchDoc(docId, { jump: { page, key: Date.now() }, highlight: null, ...(mobile ? { panel: 'pdf' } : {}) });
}
