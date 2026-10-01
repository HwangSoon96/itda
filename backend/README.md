# 잇다 백엔드

보호자 메모를 저장하고, AI로 증상 카드를 정리하고, 보호자가 확인한 기록으로 진료 요약지를 계산하는 FastAPI 서버입니다. 화면은 [`frontend/`](../frontend), 모델 학습·데이터는 [`ai/`](../ai)에 있습니다.

FastAPI, SQLAlchemy(SQLite), Pydantic, Ollama 클라이언트를 사용하며, 의존성과 실행은 [uv](https://docs.astral.sh/uv/)로 관리합니다.

## 설치

Python 3.12와 uv를 준비합니다. Python 버전은 [.python-version](.python-version), 의존성 버전은 `uv.lock`에 고정돼 있습니다.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # uv가 없을 때만
uv sync                                          # .venv 생성 + uv.lock 기준 설치
```

가상환경을 직접 켤 필요 없이 모든 명령은 `uv run`으로 실행합니다. 새 패키지는 `uv add <패키지>`로 추가합니다(`pyproject.toml`, `uv.lock`이 함께 갱신됨).

## 실행

```bash
uv run python -m app                               # http://127.0.0.1:8000
uv run uvicorn app.main:app --reload --port 8000   # 개발 중 코드 변경 시 자동 재시작
```

- 주소는 `config/settings.yaml`의 `allow_lan`이 `true`일 때만 `0.0.0.0`으로 열어 같은 Wi-Fi의 휴대폰에서 접속할 수 있습니다.
- DB는 이 폴더의 `itda.db`에 처음 실행할 때 만들어집니다. 다른 파일을 쓰려면 `ITDA_DB=demo.db uv run python -m app`.
- Ollama 주소는 기본 `http://127.0.0.1:11434`, 바꾸려면 `OLLAMA_HOST`.

### API 문서 (Swagger)

서버를 켠 뒤 브라우저에서 엽니다. 코드에서 자동으로 만들어지므로 항상 실제 API와 같습니다.

| 주소 | 내용 |
| --- | --- |
| http://127.0.0.1:8000/docs | **Swagger UI**. 경로마다 [Try it out] → 값 입력 → [Execute]로 바로 호출해 볼 수 있습니다 |
| http://127.0.0.1:8000/redoc | ReDoc. 읽기용 문서 |
| http://127.0.0.1:8000/openapi.json | OpenAPI 스펙(JSON). 다른 도구에 가져갈 때 |

API는 공통·기록·일정·요약지 · 경과 네 묶음, 24개입니다. 빈 DB로 시험하려면 `ITDA_DB=/tmp/try.db uv run python -m app`처럼 임시 파일을 쓰면 실제 기록(`itda.db`)과 섞이지 않습니다. 데모 기록이 필요하면 아래 "데모"를 봅니다.

### 데모 기록

```bash
ITDA_DB=demo.db uv run python -m app.demo load   # 빈 demo.db에 데모 메모 109개 등 (프론트엔드 샘플 모드와 같은 데이터)
ITDA_DB=demo.db uv run python -m app             # 이 DB로 서버 실행
```

기존 기록이 있는 DB에는 넣지 않습니다. 데모 기준일은 2026-09-27이라, 화면에서 기간 끝을 이 날짜로 고르면 샘플 모드와 같은 숫자가 나옵니다.

### 모델

모델은 `config/settings.yaml`의 `model_name`(정리)·`summary_model`(요약)입니다. 다른 모델로 시험할 때는 설정 파일 대신 환경변수로 바꿉니다. 이때 화면 헤더에 '임시 AI로 시험 중'이 뜹니다.

```bash
ITDA_MODEL=itda-qwen ITDA_SUMMARY_MODEL=qwen3.5:9b uv run python -m app
```

모델 호출은 비동기라 AI가 정리하는 동안에도 다른 요청은 바로 응답하고, 보호자가 도중에 창을 닫아도 정리는 끝까지 되어 저장됩니다.

### 프론트와 함께 실행

| 방법 | 설정 |
| --- | --- |
| 개발 | 이 서버를 켜고 `frontend/`에서 `pnpm dev`. vite 프록시가 `/api/...`를 이 서버로 넘깁니다 |
| 시연 | `frontend/`에서 `pnpm build` → `cp -r ../frontend/dist ./static` → 이 서버 하나만 실행 |

API 경로는 `/memos`처럼 루트에 있고, 앞에 `/api`가 붙어 와도 떼고 처리합니다. 그래서 두 방법 모두 프론트 설정을 바꾸지 않아도 됩니다.

## 개발 명령

| 명령 | 용도 |
| --- | --- |
| `uv run pytest` | 전체 테스트 |
| `uv run ruff check .` | 린트 |
| `uv run ruff format .` | 포맷 적용 (`--check`로 검사만) |

## 디렉터리 구조

```text
app/
├─ main.py          # 앱 시작, 라우터 등록, /api 접두어 처리, static 제공
├─ __main__.py      # uv run python -m app (allow_lan에 따라 주소 선택)
├─ settings.py      # config/ 설정 읽기, DB·Ollama 주소
├─ db.py            # SQLAlchemy 테이블 8개
├─ schemas.py       # API 요청·응답 모양 (프론트 decoders.ts와 짝)
├─ routers/         # health · memos(기록) · schedule(일정) · summary(요약지·경과·환자)
└─ services/        # extract · stats · summarize · texts · emergency
config/             # event_schema.json, labels.json, system_prompt.txt, settings.yaml
demo/               # 데모 기록 (발표용 demo.db를 만드는 재료)
eval/               # 증가 표시·요약 검사·수정 비율 평가 (report.py, results/)
static/             # 프론트엔드 빌드 결과 (커밋하지 않음)
tests/             # API·시나리오 테스트 (경계값, 무작위 대조, 동시 요청)
docs/               # 결정 기록
```

## 개발 기준

- `config/`의 네 파일은 AI 모델과 공유하는 계약입니다. `labels.json`·`system_prompt.txt`는 `ai/config/`와 같은 내용을 유지하고, 바꿀 때는 [결정 기록](docs/decisions.md)에 이유를 남깁니다.
- 모델 호출은 비동기로 처리하고, AI를 기다리는 동안 DB 연결을 잡지 않습니다(연결 풀 고갈로 서버가 멈추지 않게).
- AI 실패는 오류가 아닙니다. 메모는 200 + `status: "failed"` + `failure_code`로 응답합니다.
