"""Qwen3-4B-Instruct-2507을 잇다 학습 데이터로 QLoRA 학습한다. (Unsloth: 8GB GPU에 맞게 메모리 절약)
실행: ~/gg_qlora_ft_ex/.venv/bin/python ~/itda/eval/train.py [--max_steps N]
결과: ~/itda/eval/outputs/adapter (LoRA 어댑터)
"""
import argparse, json, warnings
from pathlib import Path

warnings.filterwarnings("ignore")
from unsloth import FastLanguageModel  # transformers보다 먼저 import해야 최적화가 적용됨
import torch
from datasets import Dataset
from trl import SFTConfig, SFTTrainer

MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"
DATA = Path.home() / "itda/ai/ml/data"
OUT = Path(__file__).parent / "outputs"

p = argparse.ArgumentParser()
p.add_argument("--epochs", type=float, default=2)
p.add_argument("--max_steps", type=int, default=-1, help="시험 학습용 (예: 10)")
args = p.parse_args()

model, tokenizer = FastLanguageModel.from_pretrained(MODEL_ID, max_seq_length=2048, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=32, lora_dropout=0, bias="none", use_gradient_checkpointing="unsloth",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])

def load(name):
    # messages(system, user, assistant) → prompt / completion. 손실은 completion(모델 답 JSON)에만 계산됨
    rows = []
    for line in open(DATA / name, encoding="utf-8"):
        m = json.loads(line)["messages"]
        prompt = tokenizer.apply_chat_template(m[:2], tokenize=False, add_generation_prompt=True)
        rows.append({"prompt": prompt, "completion": m[2]["content"] + tokenizer.eos_token})
    return Dataset.from_list(rows)

train_ds, val_ds = load("train.jsonl"), load("val.jsonl")
print(f"train {len(train_ds)} / val {len(val_ds)}")
trial = args.max_steps > 0

trainer = SFTTrainer(
    model=model, processing_class=tokenizer, train_dataset=train_ds, eval_dataset=val_ds,
    args=SFTConfig(
        output_dir=str(OUT / "checkpoints"),
        num_train_epochs=args.epochs, max_steps=args.max_steps,
        per_device_train_batch_size=1, gradient_accumulation_steps=8,  # 실질 배치 8 (기획안과 같음), 8GB라 1건씩
        per_device_eval_batch_size=1,
        learning_rate=2e-4, lr_scheduler_type="cosine", warmup_ratio=0.03,
        max_length=2048, bf16=True, optim="adamw_8bit",
        logging_steps=10, eval_strategy="no" if trial else "epoch",
        save_strategy="no" if trial else "epoch", save_total_limit=2,
        report_to="none", dataset_num_proc=1))

torch.cuda.reset_peak_memory_stats()
trainer.train()
trainer.model.save_pretrained(OUT / "adapter")
tokenizer.save_pretrained(OUT / "adapter")
print(f"\n어댑터 저장: {OUT / 'adapter'}")
print(f"최대 VRAM: {torch.cuda.max_memory_reserved() / 1024**3:.2f} GB")
