# 잇다 백엔드

보호자 메모를 저장하고, AI로 증상 카드를 정리하고, 보호자가 확인한 기록으로 진료 요약지를 계산하는 FastAPI 서버다. 이 저장소는 **백엔드만** 포함한다. 화면은 itda-frontend, 모델 학습·데이터는 itda-ai에 있다.

FastAPI, SQLAlchemy(SQLite), Pydantic, Ollama 클라이언트를 사용하며, 의존성과 실행은 [uv](https://docs.astral.sh/uv/)로 관리한다(itda-ai와 같은 방식).

## 설치

Python 3.12와 uv를 준비한다. Python 버전은 [.python-version](.python-version), 의존성 버전은 `uv.lock`에 고정돼 있다.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # uv가 없을 때만
uv sync                                          # .venv 생성 + uv.lock 기준 설치
```

가상환경을 직접 켤 필요 없이 모든 명령은 `uv run`으로 실행한다. 새 패키지는 `uv add <패키지>`로 추가한다(`pyproject.toml`, `uv.lock`이 함께 갱신됨).

## 실행

```bash
uv run python -m app                               # http://127.0.0.1:8000
uv run uvicorn app.main:app --reload --port 8000   # 개발 중 코드 변경 시 자동 재시작
```

- `http://localhost:8000/docs`에서 API를 바로 눌러 볼 수 있다.
- 주소는 `config/settings.yaml`의 `allow_lan`이 `true`일 때만 `0.0.0.0`으로 연다(기획안 7-4).
- DB는 레포 루트의 `itda.db`에 처음 실행할 때 만들어진다. 다른 파일을 쓰려면 `ITDA_DB=demo.db uv run python -m app`.
- Ollama 주소는 기본 `http://127.0.0.1:11434`, 바꾸려면 `OLLAMA_HOST`.

### 프론트와 함께 실행

| 방법 | 설정 |
| --- | --- |
| 개발 | 이 서버를 켜고 itda-frontend에서 `pnpm dev`. vite 프록시가 `/api/...`를 이 서버로 넘긴다 |
| 시연 | itda-frontend에서 `pnpm build` → `cp -r ../itda-frontend/dist/* ./static/` → 이 서버 하나만 실행 |

API 경로는 `/memos`처럼 루트에 있고, 앞에 `/api`가 붙어 와도 떼고 처리한다. 그래서 두 방법 모두 프론트 설정을 바꾸지 않아도 된다.

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
├─ settings.py      # config/ 동결 파일 읽기, DB·Ollama 주소
├─ db.py            # SQLAlchemy 테이블 8개 (ERD v3와 같은 제약)
├─ schemas.py       # API 요청·응답 모양 (동결, 프론트 decoders.ts와 짝)
├─ routers/         # health · memos(기록) · schedule(일정) · summary(요약지·경과·환자)
└─ services/        # extract · stats · summarize · texts · emergency
config/             # ★동결본: event_schema.json, labels.json, system_prompt.txt, settings.yaml
demo/               # 데모 기록 (발표용 demo.db를 만드는 재료)
eval/               # signal_scenarios.json (itda-ai에서 인계)
static/             # itda-frontend 빌드 결과 (커밋하지 않음)
tests/
docs/               # 결정 기록
```

## Git 관리 범위

| 구분 | 대상 |
| --- | --- |
| 공유 | `app/`, `tests/`, `config/`, `demo/`, `eval/`, `docs/`, `README.md`, `pyproject.toml`, `uv.lock`, `.python-version` |
| 제외 | `.venv/`, `.env`, `*.db`, `static/`, 캐시, 개인 파일(`*.local.*`) |

## 개발 기준

- `config/`의 네 파일은 팀 동결본이다(상세 개발 가이드 0-3). 바꿔야 하면 [결정 기록](docs/decisions.md)에 이유를 적고 전원에게 알린다. `labels.json`·`system_prompt.txt`는 itda-ai와 같은 내용이어야 한다.
- 요청·응답 모양과 계산 규칙은 팀 API 명세서 v3와 ERD · 테이블 정의서 v3를 따른다.
- 모델을 부르는 API 함수는 `async def`가 아니라 `def`로 쓴다(처리 중 서버 전체가 멈추지 않게).
- AI 실패는 오류가 아니다. 메모는 200 + `status: "failed"` + `failure_code`로 응답한다.
