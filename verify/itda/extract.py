import json, time, urllib.request
TYPES = list(json.load(open("data/labels.json"))["type"])
SCHEMA = {"type": "object", "required": ["events"], "properties": {"events": {"type": "array", "items": {
    "type": "object", "required": ["type", "status", "time_expr", "count", "evidence"],
    "properties": {"type": {"type": "string", "enum": TYPES}, "status": {"type": "string", "enum": ["present", "absent"]},
                   "time_expr": {"type": ["string", "null"]}, "count": {"type": "integer", "minimum": 1},
                   "evidence": {"type": "string"}}}}}}
SYSTEM = open("data/system_prompt.txt", encoding="utf-8").read()


def call(model, memo, timeout=120):
    body = {"model": model, "stream": False, "format": SCHEMA, "think": False, "options": {"temperature": 0},
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": memo}]}
    t = time.time()
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(), {"content-type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    return r["message"]["content"], time.time() - t
