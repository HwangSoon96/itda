# 잇다 프론트엔드

보호자 기록을 입력·확인하고, 일정·경과·진료 요약지를 살펴보는 React 앱이다. 이 저장소는 **프론트엔드만** 포함한다. 백엔드 서버, 데이터베이스, 모델 실행 환경은 별도로 준비한다.

React 19, TypeScript, Vite, Tailwind CSS 도구 구성을 사용하며, 그래프는 Recharts, 아이콘은 Lucide, 테스트는 Vitest와 Testing Library를 사용한다.

## 화면 구성

| 화면   | 주요 기능                                                                        |
| ------ | -------------------------------------------------------------------------------- |
| 기록   | 날짜를 선택해 메모 작성, 팝업에서 정리 결과 확인·수정, 지난 기록 검색, 질문 저장 |
| 일정   | 받은 진료·다음 예약, 약 변경, 의사에게 물어볼 질문 등록과 관리                   |
| 경과   | 기간별 변화와 그래프, 변화의 근거가 된 기록 조회                                 |
| 요약지 | A4 요약지 미리보기, 출력 전 미확인 기록 검토, 브라우저 인쇄·PDF 저장             |

PC와 모바일 브라우저에서 사용한다. 네이티브 모바일 앱은 포함하지 않는다. 기능별 상태와 화면 이동은 [구조와 개발 방법](docs/architecture.md)에 정리한다.

## 설치

Node.js 24와 pnpm 12.6.0을 준비한다. Node 버전은 [.nvmrc](.nvmrc), pnpm 버전은 [package.json](package.json)에 맞춘다.

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
```

## 샘플 데이터로 화면 실행

```bash
pnpm dev:mock
```

브라우저에서 <http://127.0.0.1:5173>을 연다. [.env.mock](.env.mock)의 `VITE_USE_MOCK=true`로 합성 데이터를 사용한다. **실제 AI를 호출하지 않으며, 변경한 데이터는 메모리에만 있어 새로고침하면 초기화된다.**

기록 정리 성공 흐름을 확인할 때는 다음 문장을 그대로 입력한다.

```text
새벽 3시쯤 깨서 현관문 열려고 하심. 저녁은 반 공기.
```

메모는 선택한 기록 날짜의 일을 적는다. 메모 안의 사건은 모두 같은 날짜로 검색·집계된다.

다른 문장은 `정리 실패`로 저장되어 직접 정리 흐름을 확인할 수 있다. 샘플 요약은 미리 정한 집계·문장 규칙을 사용한다.

## 별도 백엔드에 연결

처음 설정할 때 [.env.example](.env.example)을 `.env.local`로 복사한다.

```bash
cp .env.example .env.local
pnpm dev
```

| 변수                   | 설정 방법                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `ITDA_API_TARGET`      | Vite 개발 프록시의 서버 주소. 기본값 `http://127.0.0.1:8000`.                                       |
| `VITE_API_BASE_URL`    | `/api` 사용 시 개발 프록시가 접두어를 제거해 전달한다. 별도 서버에 직접 연결하면 절대 URL을 넣는다. |
| `VITE_API_CREDENTIALS` | 쿠키 전송: `same-origin`(기본), `include`, `omit`.                                                  |
| `VITE_USE_MOCK`        | 실제 HTTP는 `false`. 문자열 `true`일 때만 샘플 모드를 사용한다.                                     |

환경변수 변경 후 개발 서버를 다시 시작한다. 배포에는 별도 역방향 프록시 또는 절대 API 주소가 필요하다. 다른 origin으로 직접 요청하면 서버 CORS 설정도 확인한다. 연결 실패를 샘플 모드로 대체하지 않는다.

프론트엔드는 백엔드 API에 요청하고, AI 서버 호출은 백엔드가 담당하는 구조다. 서버 명세에 맞출 곳은 `src/api/integration.ts`와 `restContract.ts`다. HTTP 경로·요청·응답과 처리 작업 조회를 화면 코드에서 분리했다. 기본 경로는 서버의 확정 명세가 아니다. [API 연동 가이드](docs/api-contract.md)의 수정 위치와 연결 순서를 참고한다.

## 개발 명령

| 명령                | 용도                                |
| ------------------- | ----------------------------------- |
| `pnpm dev`          | 실제 HTTP API를 사용하는 개발 서버  |
| `pnpm dev:mock`     | 백엔드 없이 샘플 화면 개발          |
| `pnpm typecheck`    | TypeScript 검사                     |
| `pnpm lint`         | Oxlint 검사                         |
| `pnpm test`         | 전체 자동 테스트 실행               |
| `pnpm test:watch`   | 수정하면서 테스트 반복              |
| `pnpm format:check` | Prettier 포맷 검사                  |
| `pnpm format`       | 소스·테스트·문서 포맷 적용          |
| `pnpm build`        | 실제 API 모드의 정적 배포 파일 생성 |
| `pnpm build:mock`   | 샘플 모드의 정적 배포 파일 생성     |
| `pnpm preview`      | 생성한 `dist` 미리보기              |

`dev`와 `build`도 환경변수의 영향을 받는다. 위의 실제 API 모드 설명은 `VITE_USE_MOCK`이 생략되거나 `false`인 기본 설정 기준이다. `preview`는 백엔드를 실행하지 않는다.

## 디렉터리 구조

```text
src/
├─ app/                  # 앱 조립, 내비게이션, 기록 공간 상태, 오류 화면
│  ├─ App.tsx
│  ├─ useWorkspaceController.ts
│  ├─ navigation.ts
│  ├─ ErrorBoundary.tsx
│  └─ styles/
├─ features/
│  ├─ records/           # 기록 입력·결과 팝업·근거 선택·지난 기록
│  ├─ schedule/          # 진료일·약 변경·질문 등록과 관리
│  ├─ progress/          # 기간별 경과와 근거
│  └─ summary/           # 진료 요약지·인쇄, model.ts 차트 표시 대상 선택
├─ api/                  # 화면 계약, 서버 변환, HTTP·작업 조회, 샘플 구현
│  └─ mock/fixtures/     # 합성 JSON 데이터
├─ shared/
│  ├─ ui/               # 모달, 확인창, 로고
│  ├─ report/           # 경과·요약지에서 함께 쓰는 보고서 UI와 조회 로직
│  ├─ lib/              # 날짜, 근거 날짜, 기간 선택 등
│  └─ styles/           # 공통 토큰과 기록·일정 스타일
├─ main.tsx
└─ index.css
config/labels.json       # 팀 동결 라벨
public/assets/           # 앱과 요약지에서 사용하는 로고
tests/                   # API·화면·상태 전환 테스트
docs/                    # 구조·계약·결정 기록
```

## Git 관리 범위

| 구분 | 대상                                                                                  |
| ---- | ------------------------------------------------------------------------------------- |
| 공유 | `src/`, `tests/`, `config/`, `public/assets/`, `README.md`, 팀 공용 `docs/*.md`       |
| 공유 | `package.json`, `pnpm-lock.yaml`, `.nvmrc`, TypeScript·Vite·Vitest·Lint·Prettier 설정 |
| 공유 | `.env.example`(설정 예시), `.env.mock`(합성 데이터 모드)                              |
| 제외 | `.env.local` 등 개인 환경변수, `*.local.*` 개인 메모, IntelliJ 등 개인 IDE 설정       |
| 제외 | `node_modules/`, 빌드 결과, 캐시, 로그, 테스트 결과, 브라우저 세션과 스크린샷         |

제외 규칙은 [.gitignore](.gitignore)에서 관리한다. 개인 설정은 `.env.local`에, 개인 문서는 `*.local.md`에, 화면 캡처·PDF 등 검증 결과는 `output/`에 둔다. 이 파일들은 로컬에 보관하며 Git 공유 대상에서 제외한다.

합성 데이터인 `src/api/mock/fixtures/`와 팀 라벨 `config/labels.json`, 의존성 버전을 고정하는 `pnpm-lock.yaml`은 실행·테스트에 필요하므로 함께 공유한다. `config/labels.json`과 lockfile의 포맷 검사 제외는 Git 제외를 뜻하지 않는다.

## 개발 기준

`config/labels.json`은 팀 동결본이며, `src/api/labels.ts`에서 읽는다. 라벨 변경이 필요하면 [결정 기록](docs/decisions.md)에 이유를 적고 팀 논의를 거친다. 포맷 도구도 `config/labels.json`을 제외한다.

Tailwind 의존성과 Vite 플러그인을 구성하며 화면 스타일은 CSS 파일에서 관리한다. 공통 스타일은 `shared/styles`, 기능별 스타일은 해당 기능 폴더에 두고, 스타일 변경 시 반응형 화면과 요약지 인쇄를 함께 확인한다.

- [구조와 개발 방법](docs/architecture.md)
- [API 연동 가이드](docs/api-contract.md)
- [의사결정 기록](docs/decisions.md)
