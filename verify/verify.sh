#!/usr/bin/env bash
# 명세 v3 전체 검증: 프론트 목 서버 덤프 → 서버 규칙 대조(pytest) → 서버 JSON 예시(Pydantic) → 프론트 디코더 통과(vitest)
set -euo pipefail
FE="${FE:-$HOME/itda/frontend}"; HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
run_fe() { cp "$HERE/tools/$1" "$FE/tests/"; (cd "$FE" && pnpm exec vitest run "tests/$1" 2>&1 | grep -E "Tests "); rm -f "$FE/tests/$1"; }
echo "1) 프론트 목 서버 덤프";        run_fe mock_dump.local.test.ts
echo "2) 서버 규칙 대조 (pytest)";     (cd "$HERE" && uv run pytest -p no:cacheprovider | tail -1)
echo "3) 서버 JSON 예시 (Pydantic)";   (cd "$HERE" && uv run python make_wire_examples.py)
echo "4) 프론트 디코더 통과 (vitest)"; run_fe check_wire.local.test.ts
