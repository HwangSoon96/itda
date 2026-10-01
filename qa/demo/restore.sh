#!/bin/bash
# 시연 서버를 내리고 평소 개발 상태(백엔드 itda.db, 화면은 5173 개발 서버)로 되돌림.
systemctl --user stop itda-demo 2>/dev/null || true
rm -rf ~/itda/backend/static
systemctl --user reset-failed itda-backend 2>/dev/null || true
systemctl --user start itda-backend 2>/dev/null ||
  systemd-run --user --unit=itda-backend --working-directory=$HOME/itda/backend --setenv=PATH="$PATH" uv run python -m app >/dev/null
for i in $(seq 30); do curl -sf 127.0.0.1:8000/health >/dev/null && break; sleep 0.5; done
curl -s 127.0.0.1:8000/memos | jq -r '"평소 서버 memos \(length)"'
