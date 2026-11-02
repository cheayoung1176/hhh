# Aether Doc Parser

Aether Doc AI 앱에서 쓰는 **PDF 텍스트 추출 + 청킹 서버**예요 (Python · FastAPI · PyMuPDF).
PDF를 하나 받아서 문서 제목, 목차, 그리고 임베딩에 바로 넣을 수 있는 **청크(본문 조각 + 섹션 경로 + 페이지 번호)**를 JSON으로 돌려줘요.

## 파일 구성
| 파일 | 내용 |
|---|---|
| `doc_parser.py` | 파싱·청킹 로직 (서버 없이 단독 실행 가능) |
| `main.py` | FastAPI 서버 (`/parse`, `/health`) |
| `requirements.txt` | 설치할 패키지 목록 |
| `render.yaml` | Render 배포 설정 |
| `samples/` | 동작 확인용 샘플 PDF |

## 처리 방식
1. **PDF 검사**: PDF가 아닌 파일, 손상된 파일, 암호가 걸린 파일, 스캔본(글자 없음)을 걸러내요.
2. **잡음 제거**: 머리글/바닥글 영역, 매 페이지 반복되는 러닝헤더, 페이지 번호를 지워요.
3. **1단/2단 자동 판단**: 페이지마다 판단해요. 2단 페이지는 왼쪽 단 → 오른쪽 단 순서로 읽고, 가운데를 가로지르는 제목·표는 그 위치에서 읽어요.
4. **제목 인식**: 문서마다 다른 번호 체계를 처음 나온 순서대로 단계화해요.
   - 논문: `Ⅰ.` `1.` `1.1` `서론` `결론`
   - 보고서·공문서: `제1장` `제1절` `가.` `1)` `(1)`
   - 계약서: `제1조(목적)`
   - 번호가 없는 제목: 큰 글씨, 굵은 짧은 줄
5. **참고문헌 제외**: 참고문헌 구간은 빼요. 그 뒤에 부록 같은 새 장이 나오면 다시 포함해요.
6. **청킹**
   - 제목이 있는 문서: **섹션 단위 계층형 청킹**. 청크 앞에 `[문서 제목 | 섹션 경로]`를 붙여요. 너무 짧은 섹션은 이웃 섹션과 합치고, 경로는 공통 상위 경로로 표시해요.
   - 제목이 없는 문서: **페이지 단위 청킹**. 청크 앞에 `[문서 제목 | p.N]`을 붙여요.
   - 페이지·단 경계에서 끊긴 문단은 이어 붙이고, 긴 문단은 **문장 끝에서** 잘라요. 자른 조각끼리는 한 문장 정도 겹쳐요.

## API

### `GET /health`
```json
{ "status": "ok" }
```

### `POST /parse`
`multipart/form-data`로 `file` 필드에 PDF를 담아 보내요.
쿼리 `include_text=true`를 붙이면 추출한 전체 텍스트(`full_text`)도 함께 와요.

```bash
curl -F "file=@samples/paper_2col.pdf" http://localhost:8000/parse
```

**응답 예시 (일부)**
```json
{
  "doc": {
    "name": "paper_2col.pdf",
    "title": "경량 신경망을 활용한 온디바이스 문서 요약 기법 연구",
    "page_count": 3,
    "two_column": true,
    "two_column_pages": [1, 2, 3],
    "pages_without_text": [],
    "char_count": 4799
  },
  "toc": [
    { "title": "Ⅰ. 서론", "level": 1, "page": 1 },
    { "title": "2.1 문서 요약", "level": 2, "page": 1 }
  ],
  "chunks": [
    {
      "id": "c0003",
      "index": 3,
      "section": ["Ⅱ. 관련 연구", "2.1 문서 요약"],
      "page_start": 1,
      "page_end": 1,
      "text": "[경량 신경망을 … 연구 | Ⅱ. 관련 연구 > 2.1 문서 요약]\n2.1 문서 요약\n온디바이스 인공지능은 …",
      "body": "2.1 문서 요약\n온디바이스 인공지능은 …",
      "start": 1206,
      "end": 1598
    }
  ],
  "stats": { "chunking": "hierarchical", "chunk_count": 12, "avg_chunk_chars": 396, "heading_count": 11 }
}
```

| 필드 | 용도 |
|---|---|
| `toc` | 앱의 **목차 탭** (제목 · 단계 · 페이지) |
| `chunks[].text` | **임베딩에 넣을 텍스트** (문서 제목·섹션 경로 머리말 포함) |
| `chunks[].body` | 화면에 보여줄 본문 |
| `chunks[].page_start` | 답변의 **출처 칩** (p.N) |
| `chunks[].start / end` | `full_text` 안의 위치 (원문 하이라이트용) |
| `doc.pages_without_text` | 일부 페이지만 스캔 이미지인 경우 안내용 |

**오류 응답**: 모두 같은 모양이에요.
```json
{ "error": { "code": "no_text", "message": "PDF에서 글자를 찾지 못했어요. …" } }
```
| code | HTTP | 상황 |
|---|---|---|
| `not_pdf` | 415 | PDF가 아닌 파일 |
| `empty_file` | 400 | 빈 파일 |
| `too_large` | 413 | `MAX_UPLOAD_MB` 초과 (기본 50MB) |
| `broken_pdf` | 422 | 손상된 PDF |
| `encrypted_pdf` | 422 | 암호가 걸린 PDF |
| `empty_pdf` | 422 | 페이지가 없는 PDF |
| `no_text` | 422 | 스캔본 등 글자가 없는 PDF |
| `parse_failed` | 500 | 그 밖의 처리 오류 |

`message`는 사용자에게 그대로 보여줘도 되는 문장이에요.

## 내 컴퓨터에서 실행하기 (Windows 기준)
Python 3.10 이상이 필요해요 ([python.org](https://www.python.org)에서 설치, 설치할 때 **"Add python.exe to PATH" 체크**).

VS Code에서 이 폴더를 열고, 터미널을 **Command Prompt**로 열어서 실행하세요.
```bat
python -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements.txt
uvicorn main:app --reload
```
- 브라우저에서 **http://localhost:8000/docs** 를 열면 화면에서 바로 PDF를 올려 테스트할 수 있어요 (`POST /parse` → Try it out).
- 서버 없이 파서만 확인하려면:
  ```bat
  python doc_parser.py samples\paper_2col.pdf
  ```
- 다음부터는 `.venv\Scripts\activate.bat` 후 `uvicorn main:app --reload`만 하면 돼요.

> PowerShell을 쓰면 `activate` 단계에서 "스크립트를 실행할 수 없습니다" 오류가 날 수 있어요. Command Prompt를 쓰거나, Next.js 때처럼 실행 정책을 바꾸면 돼요.

### 샘플 기대 결과
| 샘플 | 2단 | 청킹 | 청크 수 | 확인할 점 |
|---|---|---|---|---|
| `paper_2col.pdf` | O | 계층형 | 12 | 목차 Ⅰ~Ⅴ와 2.1~4.2, 참고문헌 제외, 저자 줄은 제목이 아님 |
| `report.pdf` | X | 계층형 | 13 | 제1장 > 제1절 > 1. > 가. 단계, 참고문헌 제외 후 부록 포함 |
| `contract.pdf` | X | 계층형 | 6 | 제1조~제6조가 목차로 인식 |
| `plain.pdf` | X | 페이지 | 7 | 제목 없음 → 페이지 단위 청킹 |
| `scanned.pdf` | – | – | – | `no_text` 오류 |

PyMuPDF 버전에 따라 블록 나누는 방식이 조금 달라서 청크 수가 한두 개 다를 수 있어요. 목차와 2단 판단이 위와 같으면 정상이에요.

## Render 배포
1. 이 폴더를 **별도의 GitHub 저장소**로 올려요 (예: `aether-doc-parser`).
2. [render.com](https://render.com) 가입 → **New → Blueprint** → 저장소 선택. `render.yaml`을 읽어서 설정이 자동으로 채워져요.
   - Blueprint 대신 **New → Web Service**로 만들어도 돼요:
     - Runtime: `Python 3`
     - Build Command: `pip install -r requirements.txt`
     - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
     - Instance Type: `Free`
3. **Environment**에서 `ALLOWED_ORIGINS`를 앱 주소로 바꿔요. 여러 개면 쉼표로 구분해요.
   ```
   ALLOWED_ORIGINS=https://aether-doc-ai.vercel.app,http://localhost:3000
   ```
   Vercel 미리보기 주소까지 허용하려면 `ALLOWED_ORIGIN_REGEX=https://.*\.vercel\.app`을 추가해요.
4. 배포가 끝나면 `https://<서비스명>.onrender.com/health`가 `{"status":"ok"}`를 돌려주는지 확인해요.

### 무료 플랜 주의사항
- 15분 동안 요청이 없으면 서버가 잠들고, 다음 요청에서 깨어나는 데 **약 1분** 걸려요. 시연 전에 `/health`를 한 번 열어 깨워 두세요.
- 메모리 512MB, CPU 0.1개라서 **수백 페이지 PDF는 느리거나 실패할 수 있어요.** 이 경우 Starter 플랜(월 $7)으로 올리면 돼요.

## 알려진 한계
- 스캔한 이미지 PDF는 글자를 읽지 못해요 (OCR 미지원).
- 2단 페이지 중간에 있는 큰 표·그림은 읽기 순서가 어긋날 수 있어요.
- 표는 칸 구조 없이 글자만 추출돼요.
- 이어진 문단을 합친 경우 `page_start`는 문단이 시작된 페이지예요.

## 라이선스
PyMuPDF는 **AGPL-3.0**이에요. 이 서버를 공개 서비스로 운영하면 소스 코드도 공개해야 해요. GitHub 공개 저장소로 두면 충족돼요.
