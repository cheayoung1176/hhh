// 전역 상태 저장소 (명세서 2.3: Zustand)
// 브레이크포인트가 바뀌어 레이아웃 컴포넌트가 다시 그려져도, 아래 상태는 그대로 남는다.
//   PDF 페이지 번호·스크롤 좌표·확대 비율, 선택한 서브탭, 보내지 않은 입력, 대화 세션
// 정렬 상태(F-06)는 대화 데이터와 분리해서 보관한다.
import { create } from 'zustand';

const DOC_DEFAULT = {
  page: 1,          // PDF 뷰어 현재 페이지
  scrollTop: 0,     // PDF 뷰어 스크롤 좌표
  zoom: 1,          // PDF 확대 비율
  subtab: 'summary',// [요약] [목차] [키워드]
  panel: 'analysis',// 모바일 상단 탭: analysis | chat | pdf,  태블릿·데스크톱 오른쪽 패널: analysis | chat
  draft: '',        // 보내지 않은 입력 (F-08)
  sessionId: null,  // 현재 대화 세션
  messages: [],     // 현재 대화 [{key, role, content, sources, time, streaming, interrupted, none}]
  highlight: null,  // {page, rects:[[x0,y0,x1,y1]], color} 출처 하이라이트 (F-09)
};

export const useApp = create((set, get) => ({
  // ---------------------------------------------------------- 로그인
  authState: 'loading', // loading | out | in
  user: null,
  setAuth: (user) => set({ user, authState: user ? 'in' : 'out' }),

  // ---------------------------------------------------------- 화면 이동
  view: 'home', // home | docs | chat | settings | detail
  docId: null,
  go: (view, docId = null) => set((s) => ({ view, docId: docId ?? (view === 'detail' ? s.docId : s.docId) })),

  // ---------------------------------------------------------- 문서 목록 (F-05, F-06)
  docs: [],
  docsState: 'idle', // idle | loading | ready | error
  sort: 'latest',
  query: '',
  setSort: (sort) => set({ sort }),
  setQuery: (query) => set({ query }),
  setDocs: (docs) => set({ docs, docsState: 'ready' }),
  setDocsState: (docsState) => set({ docsState }),
  upsertDoc: (doc) =>
    set((s) => {
      const i = s.docs.findIndex((d) => d.doc_id === doc.doc_id);
      if (i < 0) return { docs: [doc, ...s.docs] };
      const docs = s.docs.slice();
      docs[i] = { ...docs[i], ...doc };
      return { docs };
    }),
  removeDoc: (id) =>
    set((s) => {
      const docState = { ...s.docState };
      delete docState[id];
      return { docs: s.docs.filter((d) => d.doc_id !== id), docState };
    }),

  // ---------------------------------------------------------- 문서별 화면 상태 (2.3)
  docState: {},
  doc: (id) => ({ ...DOC_DEFAULT, ...(get().docState[id] || {}) }),
  patchDoc: (id, patch) =>
    set((s) => {
      const cur = { ...DOC_DEFAULT, ...(s.docState[id] || {}) };
      const next = typeof patch === 'function' ? patch(cur) : patch;
      return { docState: { ...s.docState, [id]: { ...cur, ...next } } };
    }),

  // ---------------------------------------------------------- 알림 (z-index 2000) · 모달 (z-index 1000)
  toast: null,
  showToast: (msg, icon = 'info', tone = '') => set({ toast: { msg, icon, tone, key: Date.now() + Math.random() } }),
  hideToast: () => set({ toast: null }),
  modal: null,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
}));

export const docDefaults = DOC_DEFAULT;
