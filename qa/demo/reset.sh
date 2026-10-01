#!/bin/bash
# 시연 준비: 평소 서버를 내리고, 바탕화면 itda.db 복사본 + 빌드된 화면으로 시연 서버(8000)를 띄움.
# 끝나면 restore.sh 로 평소 상태로 돌린다.
set -e
systemctl --user stop itda-backend itda-demo 2>/dev/null || true
mkdir -p /tmp/demo
cp /mnt/c/Users/Admin/Desktop/itda.db /tmp/demo/itda.db
rm -f /tmp/demo/itda.db-wal /tmp/demo/itda.db-shm
cd ~/itda/frontend
[ -d dist ] || ./node_modules/.bin/vite build >/dev/null
rm -rf ~/itda/backend/static
cp -r dist ~/itda/backend/static
systemctl --user reset-failed itda-demo 2>/dev/null || true
cd ~/itda/backend
systemd-run --user --unit=itda-demo --working-directory=$PWD --setenv=PATH="$PATH" --setenv=ITDA_DB=/tmp/demo/itda.db uv run python -m app >/dev/null
for i in $(seq 30); do curl -sf 127.0.0.1:8000/api/health >/dev/null && break; sleep 0.5; done
curl -sf 127.0.0.1:8000/ >/dev/null || { echo "화면 404"; exit 1; }
curl -s 127.0.0.1:8000/api/memos | jq -r '"memos \(length)"'
curl -s -X POST 127.0.0.1:11434/api/generate -d '{"model":"itda-gemma4-e4b-q4_k_m","prompt":"","keep_alive":"30m"}' >/dev/null
