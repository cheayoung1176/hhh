// MVP v.2 샘플 데이터 — Stitch 화면(사진)에 나온 내용 그대로
export const MB = 1024 * 1024;

export const INITIAL_DOCS = [
  { id: "d1", name: "2024_AI_산업동향_보고서.pdf", date: "2026-10-19T10:20:00", size: 4.8 * MB, status: "success", pages: 42, hasDetail: true },
  { id: "d2", name: "서비스_기획안_v2.pdf", date: "2026-10-19T09:05:00", size: 12.4 * MB, status: "success" },
  { id: "d3", name: "계약서_최종본_검토.pdf", date: "2026-10-18T15:40:00", size: 3.2 * MB, status: "progress", delayed: true },
  { id: "d4", name: "스캔본_회의록_2026.pdf", date: "2026-10-17T11:00:00", size: 8.1 * MB, status: "fail" },
  { id: "d5", name: "투자유치설명서_IR_덱.pdf", date: "2026-10-15T17:30:00", size: 15.6 * MB, status: "success" },
];

export const SORTS = [
  { key: "recent", label: "최신순" },
  { key: "name", label: "이름순" },
  { key: "size", label: "용량순" },
];

export function sortDocs(docs, key) {
  const arr = [...docs];
  if (key === "name") arr.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  else if (key === "size") arr.sort((a, b) => b.size - a.size);
  else arr.sort((a, b) => (a.date < b.date ? 1 : -1));
  return arr;
}

export function fmtDate(iso) {
  return iso.slice(0, 10).replaceAll("-", ".");
}

// 목록: "4.8MB", 업로드 카드: "4.8 MB"
export function fmtSize(bytes, spaced = false) {
  const unit = spaced ? " " : "";
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)}${unit}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}${unit}KB`;
}

export const SUMMARY_PLAIN =
  "온디바이스 AI 반도체 시장은 보안성과 초저지연성을 바탕으로 연평균 28.5% (CAGR 28.5%)의 고성장이 전망됩니다. " +
  "특히 모바일 및 엣지 디바이스 내 NPU 탑재가 보편화되면서 전력 효율성 극대화와 맞춤형 경량화 모델 도입이 핵심 경쟁력으로 부상하고 있습니다.";

export const KEYWORDS = ["온디바이스 AI", "NPU", "CAGR", "개인정보 보호", "파운드리", "전력 효율"];

export function questionFor(kw) {
  if (kw === "개인정보 보호") {
    return { q: "“개인정보 보호” 관련 조항 및 보안 기술을 정리해줘", ref: "보고서 18p 온디바이스 보안 아키텍처 참조" };
  }
  return { q: `“${kw}”에 대해 이 문서에서 설명해줘`, ref: "문서에서 관련 내용을 찾아 답변합니다" };
}

// F-02-2: 허용하지 않는 스크립트 패턴
const SCRIPT_RE = /<\s*\/?\s*[a-z!]|\b(?:javascript|vbscript)\s*:|\bdata\s*:\s*text\/html|\bon[a-z]{3,}\s*=/i;
export const INVALID_STRING = "유효하지 않은 문자열이 포함되어 있습니다";
export function hasScript(text) {
  return SCRIPT_RE.test(text) || text.includes("\u0000");
}
