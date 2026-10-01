#!/usr/bin/env bash
# 학습한 어댑터를 원본 모델에 합치고 → GGUF 변환 → Q4_K_M 양자화 → Ollama에 등록
# 실행: bash ~/itda/eval/export.sh [어댑터 폴더] [Ollama 모델 이름]
#   기본값: outputs/adapter → itda-qwen
#   1에폭:  bash ~/itda/eval/export.sh outputs/checkpoints/checkpoint-248 itda-qwen-ep1
set -euo pipefail
cd "$(dirname "$0")"
PY=~/gg_qlora_ft_ex/.venv/bin/python
LLAMA=~/gg_qlora_ft_ex/llama.cpp
OUT=$PWD/outputs
export ADAPTER=${1:-outputs/adapter}
NAME=${2:-itda-qwen}

echo "[1/4] 어댑터 합치기 (CPU, 몇 분 걸림)"
$PY - <<'EOF'
import os, torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
base = AutoModelForCausalLM.from_pretrained("Qwen/Qwen3-4B-Instruct-2507", dtype=torch.bfloat16, device_map="cpu")
model = PeftModel.from_pretrained(base, os.environ["ADAPTER"]).merge_and_unload()
model.save_pretrained("outputs/merged", safe_serialization=True)
AutoTokenizer.from_pretrained("Qwen/Qwen3-4B-Instruct-2507").save_pretrained("outputs/merged")
EOF

echo "[2/4] GGUF 변환"
$PY $LLAMA/convert_hf_to_gguf.py $OUT/merged --outfile $OUT/$NAME-f16.gguf --outtype f16

echo "[3/4] Q4_K_M 양자화"
$LLAMA/build/bin/llama-quantize $OUT/$NAME-f16.gguf $OUT/$NAME-q4_k_m.gguf Q4_K_M

echo "[4/4] Ollama 등록 (템플릿은 원본 Qwen과 같게, 시스템 프롬프트는 팀 레포 것)"
{
  echo "FROM $OUT/$NAME-q4_k_m.gguf"
  ollama show qwen3:4b-instruct-2507-q4_K_M --modelfile | grep -vE '^(#|FROM|PARAMETER temperature)'
  echo 'PARAMETER temperature 0'
  printf 'SYSTEM """'; cat ~/itda/ai/config/system_prompt.txt; echo '"""'
} > $OUT/$NAME.Modelfile
ollama create $NAME -f $OUT/$NAME.Modelfile

rm -rf $OUT/merged $OUT/$NAME-f16.gguf  # 중간 파일 정리 (약 16GB)
echo "완료: ollama run $NAME"
