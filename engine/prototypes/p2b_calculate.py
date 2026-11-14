"""P2b throwaway: with a calculate tool, can a small local model answer Scenario 2 correctly?"""
import sys, time, json
MODELS = sys.argv[1:] or ["qwen2.5:3b", "llama3.2:3b"]
import httpx, csv
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "demo" / "data"
csv_text = (DATA / "employees.csv").read_text()
rows = list(csv.DictReader(csv_text.splitlines()))
avg = sum(int(r["salary"]) for r in rows) / len(rows)
top = max(rows, key=lambda r: int(r["salary"]))["name"]
TOOLS = [{"type": "function", "function": {"name": "calculate", "description": "Evaluate an arithmetic expression exactly, e.g. (1+2+3)/3. Use it for any arithmetic.",
          "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}}}]
S2 = "Read employees.csv and tell me the average salary and who earns the most."

def chat(model, messages):
    t = time.time()
    r = httpx.post("http://localhost:11434/api/chat", timeout=180, json={"model": model, "messages": messages, "tools": TOOLS, "stream": False, "think": False, "options": {"temperature": 0}})
    return r.json()["message"], time.time() - t

for model in MODELS:
    ok, times = 0, []
    for _ in range(5):
        msgs = [{"role": "user", "content": S2},
                {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "read_file", "arguments": {"path": "employees.csv"}}}]},
                {"role": "tool", "content": csv_text}]
        text = ""
        for _ in range(4):
            m, dt = chat(model, msgs); times.append(dt)
            msgs.append(m)
            calls = m.get("tool_calls") or []
            if not calls:
                text = m.get("content", ""); break
            for c in calls:
                expr = c["function"]["arguments"].get("expression", "")
                try: val = str(eval(expr, {"__builtins__": {}}))
                except Exception as e: val = f"error: {e}"
                msgs.append({"role": "tool", "content": val})
        good = top in text and ("117,200" in text or "117200" in text)
        ok += good
    print(f"{model:14} calc-assisted correct {ok}/5 mean {sum(times)/len(times):.1f}s max {max(times):.1f}s | last: {text[:200]!r}")
