"""config/ 동결 파일 읽기. 값은 여기서 고치지 않고 config/settings.yaml에서 고친다."""

import json
import os
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"
STATIC = ROOT / "static"


@lru_cache
def settings() -> dict:
    return yaml.safe_load((CONFIG / "settings.yaml").read_text(encoding="utf-8"))


@lru_cache
def labels() -> dict[str, dict[str, str]]:
    return json.loads((CONFIG / "labels.json").read_text(encoding="utf-8"))


@lru_cache
def event_schema() -> dict:
    return json.loads((CONFIG / "event_schema.json").read_text(encoding="utf-8"))


@lru_cache
def system_prompt() -> str:
    return (CONFIG / "system_prompt.txt").read_text(encoding="utf-8")


def db_path() -> Path:
    """ITDA_DB로 다른 DB 파일을 쓸 수 있음 (발표 때 demo.db, 명세 F17)."""
    return Path(os.environ.get("ITDA_DB", ROOT / "itda.db"))


def ollama_host() -> str:
    return os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
