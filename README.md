# 잇다 (itda)

치매 환자 보호자가 남긴 관찰 메모를 AI로 증상 기록으로 정리하고, 경과와 진료 요약지로 보여주는 서비스.

| 폴더 | 내용 |
| --- | --- |
| [`ai/`](ai/) | 메모 → 증상 JSON 변환 소형 LLM의 데이터·학습·평가 |
| [`backend/`](backend/) | 메모 저장, 증상 카드 정리, 진료 요약지 계산 FastAPI 서버 |
| [`frontend/`](frontend/) | 기록·일정·경과·요약지 화면 React 앱 |

각 폴더의 README에 설치와 실행 방법이 있다.

원본: [OHNAJOO/itda-ai](https://github.com/OHNAJOO/itda-ai) · [OHNAJOO/itda-backend](https://github.com/OHNAJOO/itda-backend) · [OHNAJOO/itda-frontend](https://github.com/OHNAJOO/itda-frontend) 의 `main`을 커밋 기록 그대로 합쳤다.
