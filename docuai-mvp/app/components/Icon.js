// 인라인 SVG 아이콘 (외부 아이콘 폰트에 의존하지 않음 — 느린 네트워크에서도 글자 대신 아이콘이 보이도록)
const PATHS = {
  search: ["M21 21l-4.3-4.3", { c: [11, 11, 8] }],
  bell: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  chevronDown: ["M6 9l6 6 6-6"],
  checkCircle: [{ c: [12, 12, 10] }, "M9 12l2 2 4-4"],
  check: ["M20 6 9 17l-5-5"],
  alertCircle: [{ c: [12, 12, 10] }, "M12 8v4", "M12 16h.01"],
  info: [{ c: [12, 12, 10] }, "M12 16v-4", "M12 8h.01"],
  pencil: ["M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z", "M15 5l4 4"],
  trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6", "M14 11v6"],
  plus: ["M5 12h14", "M12 5v14"],
  home: [
    "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
    "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  ],
  folder: ["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],
  chat: ["M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z", "M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"],
  chatSingle: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  settings: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    { c: [12, 12, 3] },
  ],
  arrowLeft: ["M12 19l-7-7 7-7", "M19 12H5"],
  chevronLeft: ["M15 18l-6-6 6-6"],
  arrowRight: ["M5 12h14", "M12 5l7 7-7 7"],
  arrowUp: ["M5 12l7-7 7 7", "M12 19V5"],
  user: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", { c: [12, 7, 4] }],
  filePlus: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M9 15h6", "M12 18v-6"],
  fileText: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
  fileSearch: ["M14 2v4a2 2 0 0 0 2 2h4", "M4 7V4a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2", { c: [9, 15, 3] }, "M11.2 17.2 13 19"],
  folderOpen: [
    "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  ],
  x: ["M18 6 6 18", "M6 6l12 12"],
  moreVertical: [{ c: [12, 5, 1] }, { c: [12, 12, 1] }, { c: [12, 19, 1] }],
  share: [{ c: [18, 5, 3] }, { c: [6, 12, 3] }, { c: [18, 19, 3] }, "M8.59 13.51l6.83 3.98", "M15.41 6.51l-6.82 3.98"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  hash: ["M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3l-2 18"],
  trending: ["M22 7l-8.5 8.5-5-5L2 17", "M16 7h6v6"],
  copy: ["M8 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z", "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"],
  pointer: [
    "M22 14a8 8 0 0 1-8 8",
    "M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2",
    "M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1",
    "M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10",
    "M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
  ],
  bot: ["M12 8V4H8", "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2"],
  grid: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M3 9h18", "M3 15h18", "M9 3v18", "M15 3v18"],
  insight: [
    "M12 3a6 6 0 0 0-6 6c0 2.2 1.2 3.7 2.4 4.8.7.7 1.1 1.5 1.1 2.4V17h5v-.8c0-.9.4-1.7 1.1-2.4C16.8 12.7 18 11.2 18 9a6 6 0 0 0-6-6z",
    "M9.5 21h5",
    "M12 7v4",
    "M10 9h4",
  ],
};

// 반짝이(4각 별) — 채움 아이콘
const SPARKLES = (
  <>
    <path d="M10 2.5l1.7 5.1 5.1 1.7-5.1 1.7L10 16.1l-1.7-5.1L3.2 9.3l5.1-1.7z" />
    <path d="M18 13l.9 2.6 2.6.9-2.6.9L18 20l-.9-2.6-2.6-.9 2.6-.9z" />
  </>
);

export default function Icon({ name, size = 24, stroke = 2, className, style, title }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className,
    style,
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
    focusable: "false",
  };
  if (name === "sparkles") {
    return (
      <svg {...common} fill="currentColor">
        {title && <title>{title}</title>}
        {SPARKLES}
      </svg>
    );
  }
  const parts = PATHS[name];
  if (!parts) return null;
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {title && <title>{title}</title>}
      {parts.map((p, i) =>
        typeof p === "string" ? <path key={i} d={p} /> : <circle key={i} cx={p.c[0]} cy={p.c[1]} r={p.c[2]} />
      )}
    </svg>
  );
}

// 빨간 PDF 파일 아이콘 (사진의 카드 왼쪽 아이콘)
export function PdfBadge({ size = 56 }) {
  return (
    <span className="pdf-badge" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M7 3h9l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#fff" />
        <path d="M4 7v13a1 1 0 0 0 1 1h11" />
        <text x="13" y="14.6" fontSize="5.4" fontWeight="800" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Arial, sans-serif">
          PDF
        </text>
      </svg>
    </span>
  );
}
