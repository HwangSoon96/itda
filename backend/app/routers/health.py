"""GET /health: 서버·모델 상태와 화면 고정 문구 (명세 F12)."""

from fastapi import APIRouter
from ollama import AsyncClient

from ..schemas import Health
from ..settings import ollama_host, settings

router = APIRouter(tags=["공통"])


async def model_ready(name: str) -> bool:
    """정리 모델이 Ollama에 있으면 True, 없으면 False, Ollama에 연결이 안 되면 False."""
    try:
        models = (await AsyncClient(host=ollama_host(), timeout=2).list()).models
    except Exception:  # 연결 실패·시간 초과 모두 '준비 안 됨'
        return False
    names = {m.model for m in models}
    return name in names or f"{name}:latest" in names


@router.get("/health", response_model=Health, summary="서버·모델 상태와 고정 문구")
async def health() -> Health:  # Ollama를 비동기로 확인 (명세 V04)
    s = settings()
    return Health(
        ok=True,
        ai_available=await model_ready(s["model_name"]),
        model_name=s["model_name"],
        allow_lan=s["allow_lan"],
        emergency_keywords=s["emergency_keywords"],
        emergency_message=s["emergency_message"],
        ai_notice=s["ai_notice"],
        disclaimer=s["disclaimer"],
        temporary_model=s.get("temporary_model", False),
    )
