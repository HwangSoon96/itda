# itda-frontend

## 기술 스택

- React
- TypeScript
- Vite
- Tailwind CSS
- 패키지 매니저: pnpm

## 시작하기

```bash
pnpm install
pnpm dev       # 개발 서버 실행
pnpm build     # 프로덕션 빌드
pnpm lint      # 린트
```

## 디렉토리 구조

```
itda-frontend/
├─ src/
│   ├─ api/            # API 타입 및 라벨, mock 데이터
│   │   ├─ types.ts
│   │   ├─ labels.ts
│   │   └─ mock/
│   ├─ App.tsx          # 화면 컴포넌트
│   ├─ main.tsx
│   ├─ index.css
│   └─ print.css        # 인쇄용 스타일
├─ config/
│   └─ labels.json      # 라벨 설정 (★동결본)
├─ docs/
│   └─ decisions.md     # 의사결정 기록
└─ README.md
```

## 참고

- `config/labels.json`은 동결본이므로 임의로 수정하지 않습니다. 변경이 필요하면 `docs/decisions.md`에 이유를 기록한 뒤 논의를 거쳐 수정합니다.
