"""P2c throwaway: calculator with mean/max/min/sum functions, five runs per model."""
import csv, json, statistics, sys, time
from pathlib import Path
import httpx

csv_text = Path(__file__).resolve().parent.parent.joinpath("demo/data/employees.csv").read_text()
rows = list(csv.DictReader(csv_text.splitlines()))
top = max(rows, key=lambda r: int(r["salary"]))["name"]
FUNCS = {"mean": lambda *a: statistics.mean(a), "average": lambda *a: statistics.mean(a), "max": max, "min": min, "sum": lambda *a: sum(a)}
TOOLS = [{"type": "function", "function": {"name": "calculate",
          "description": "Evaluate arithmetic exactly. Supports + - * / and mean(...), max(...), min(...), sum(...). Use it for any arithmetic instead of computing in your head.",
          "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}}}]
S2 = "Read employees.csv and tell me the average salary and who earns the most."

for model in sys.argv[1:]:
    ok, times = 0, []
    for _ in range(5):
        msgs = [{"role": "user", "content": S2},
                {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "read_file", "arguments": {"path": "employees.csv"}}}]},
                {"role": "tool", "content": csv_text}]
        text, exprs = "", []
        for _ in range(5):
            t = time.time()
            m = httpx.post("http://localhost:11434/api/chat", timeout=240, json={"model": model, "messages": msgs, "tools": TOOLS, "stream": False, "options": {"temperature": 0}}).json()["message"]
            times.append(time.time() - t)
            msgs.append(m)
            calls = m.get("tool_calls") or []
            if not calls:
                text = m.get("content", ""); break
            for c in calls:
                e = c["function"]["arguments"].get("expression", ""); exprs.append(e[:60])
                try: val = str(eval(e, {"__builtins__": {}}, FUNCS))
                except Exception as ex: val = f"error: {ex}"
                msgs.append({"role": "tool", "content": val})
        good = top in text and ("117,200" in text or "117200" in text)
        ok += good
        print(f"  {model} good={good} exprs={exprs} answer={text[:140]!r}")
    print(f"{model:14} correct {ok}/5 mean {statistics.mean(times):.1f}s max {max(times):.1f}s")
