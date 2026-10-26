"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import DocsScreen from "./DocsScreen";
import UploadScreen from "./UploadScreen";
import DetailScreen from "./DetailScreen";
import { Modal, Toast, useToast } from "./ui";
import { INITIAL_DOCS, INVALID_STRING, MB, hasScript } from "./data";

const NAV = [
  { key: "home", label: "홈", icon: "home" },
  { key: "docs", label: "내 문서", icon: "folder" },
  { key: "chat", label: "AI 대화", icon: "chat" },
  { key: "settings", label: "설정", icon: "settings" },
];

const SAMPLE_UPLOAD = [{ id: "sample-1", name: "2024_AI_산업동향_보고서.pdf", size: 4.8 * MB }];

export default function DocuApp() {
  const [screen, setScreen] = useState("docs"); // docs | upload | detail
  const [docs, setDocs] = useState(INITIAL_DOCS);
  const [sortKey, setSortKey] = useState("recent");
  const [detailId, setDetailId] = useState(null);
  const [files, setFiles] = useState(SAMPLE_UPLOAD);
  const [modal, setModal] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [toast, notify] = useToast();
  const docsScroll = useRef(0);

  const soon = (what) => notify(`${what} 기능은 준비 중입니다`);

  // 화면 전환 시 스크롤: 상세/업로드는 맨 위, 내 문서로 돌아오면 보던 위치로
  const go = (next) => {
    if (screen === "docs") docsScroll.current = window.scrollY;
    setScreen(next);
  };
  useEffect(() => {
    window.scrollTo(0, screen === "docs" ? docsScroll.current : 0);
  }, [screen]);

  const openDoc = (d) => {
    if (d.status === "progress") return notify("문서를 분석하고 있어요. 잠시만 기다려 주세요."); // F-05-1
    if (d.status === "fail") return soon("분석 실패 문서 처리(재분석·삭제)");
    if (!d.hasDetail) return soon("이 문서의 상세 화면");
    setDetailId(d.id);
    go("detail");
  };

  const confirmDelete = (d) => {
    setModal(null);
    setRemovingId(d.id);
    setTimeout(() => {
      setDocs((cur) => cur.filter((x) => x.id !== d.id));
      setRemovingId(null);
      notify("문서를 삭제했습니다");
    }, 260);
  };

  const nav = (
    <nav className="fixed-col bottomnav" aria-label="주 메뉴">
      {NAV.map((n) => (
        <button
          key={n.key}
          className={n.key === "docs" ? "on" : ""}
          aria-current={n.key === "docs" ? "page" : undefined}
          onClick={() => (n.key === "docs" ? window.scrollTo({ top: 0, behavior: "smooth" }) : soon(n.label))}
        >
          <Icon name={n.icon} size={26} stroke={n.key === "docs" ? 2.2 : 2} />
          {n.label}
        </button>
      ))}
    </nav>
  );

  const detailDoc = docs.find((d) => d.id === detailId);

  return (
    <div className="phone">
      {screen === "docs" && (
        <DocsScreen
          docs={docs}
          sortKey={sortKey}
          setSortKey={setSortKey}
          removingId={removingId}
          onOpenDoc={openDoc}
          onRename={(d) => setModal({ type: "rename", doc: d })}
          onDelete={(d) => setModal({ type: "delete", doc: d })}
          onUpload={() => go("upload")}
          onSoon={soon}
          nav={nav}
        />
      )}
      {screen === "upload" && (
        <UploadScreen
          files={files}
          setFiles={setFiles}
          onBack={() => go("docs")}
          onSoon={soon}
          onInvalid={() => setModal({ type: "invalid" })}
        />
      )}
      {screen === "detail" && detailDoc && (
        <DetailScreen doc={detailDoc} onBack={() => go("docs")} onSoon={soon} notify={notify} />
      )}

      {modal?.type === "delete" && (
        <Modal icon="trash" tone="warn" title="문서를 삭제할까요?" onClose={() => setModal(null)}>
          <p>
            “{modal.doc.name}”
            <br />
            삭제된 데이터는 복구할 수 없습니다.
          </p>
          <div className="acts">
            <button className="cancel" onClick={() => setModal(null)}>
              취소
            </button>
            <button className="danger" onClick={() => confirmDelete(modal.doc)}>
              삭제
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "rename" && (
        <RenameModal
          doc={modal.doc}
          onClose={() => setModal(null)}
          onSave={(name) => {
            setDocs((cur) => cur.map((x) => (x.id === modal.doc.id ? { ...x, name } : x)));
            setModal(null);
            notify("이름을 변경했습니다");
          }}
        />
      )}
      {modal?.type === "invalid" && (
        <Modal icon="alertCircle" tone="warn" title="업로드할 수 없는 파일입니다" onClose={() => setModal(null)}>
          <p>PDF 파일만 업로드할 수 있습니다. (최대 50MB)</p>
          <div className="acts">
            <button className="ok" onClick={() => setModal(null)}>
              확인
            </button>
          </div>
        </Modal>
      )}

      <Toast toast={toast} />
    </div>
  );
}

function RenameModal({ doc, onClose, onSave }) {
  const stem = doc.name.replace(/\.pdf$/i, "");
  const [value, setValue] = useState(stem);
  const [err, setErr] = useState("");
  const save = () => {
    const v = value.trim();
    if (!v) return setErr("이름을 입력해 주세요.");
    if (hasScript(v)) return setErr(INVALID_STRING); // F-02-2
    onSave(`${v.replace(/\.pdf$/i, "")}.pdf`);
  };
  return (
    <Modal icon="pencil" tone="info" title="이름변경" onClose={onClose}>
      <div className="field">
        <label className="sr-only" htmlFor="rename-input">
          새 문서 이름
        </label>
        <input
          id="rename-input"
          value={value}
          maxLength={100}
          onChange={(e) => {
            setValue(e.target.value);
            setErr("");
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          aria-invalid={!!err}
          aria-describedby={err ? "rename-err" : undefined}
        />
        {err && (
          <div className="err" id="rename-err" role="alert">
            {err}
          </div>
        )}
      </div>
      <div className="acts">
        <button className="cancel" onClick={onClose}>
          취소
        </button>
        <button className="ok" onClick={save}>
          저장
        </button>
      </div>
    </Modal>
  );
}
