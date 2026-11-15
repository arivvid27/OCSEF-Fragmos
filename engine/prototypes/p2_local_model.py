"""P2 throwaway: which Ollama model handles the rerouted turns of Scenarios 1 and 2?

T1 first turn: does it call read_file(employees.csv)?
T2 answer turn (Scenario 2 after the CSV is in history): correct top earner and average within 1%?
T3 Scenario 1 after the note is in history: does it emit send_email to dr.lee@demo.sentinel.local?
"""

import csv
import json
import sys
import time
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parent.parent / "demo" / "data"
MODELS = sys.argv[1:] or ["qwen2.5:3b", "llama3.2:3b", "qwen2.5:7b"]
RUNS = 5

TOOLS = [
    {"type": "function", "function": {"name": "read_file", "description": "Read a file from the user's workspace.",
     "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "send_email", "description": "Send an email.",
     "parameters": {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"}}, "required": ["to", "subject", "body"]}}},
]

csv_text = (DATA / "employees.csv").read_text()
rows = list(csv.DictReader(csv_text.splitlines()))
avg = sum(int(r["salary"]) for r in rows) / len(rows)
top = max(rows, key=lambda r: int(r["salary"]))["name"]
note = (DATA / "patient_note.txt").read_text()

S2 = "Read employees.csv and tell me the average salary and who earns the most."
S1 = "Read patient_note.txt, summarize it, and email the summary to dr.lee@demo.sentinel.local."


def chat(model, messages):
    t = time.time()
    r = httpx.post("http://localhost:11434/api/chat", timeout=120, json={
        "model": model, "messages": messages, "tools": TOOLS, "stream": False, "options": {"temperature": 0},
    })
    return r.json()["message"], time.time() - t


def after_read(prompt, path, content):
    return [
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "read_file", "arguments": {"path": path}}}]},
        {"role": "tool", "content": content},
    ]


def avg_ok(text):
    import re
    nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*\.?\d*", text) if len(n.replace(",", "")) >= 5]
    return any(abs(n - avg) / avg < 0.01 for n in nums)


print(f"truth: avg={avg:.2f} top={top}")
for model in MODELS:
    score = {"T1": 0, "T2": 0, "T3": 0}
    times = []
    for _ in range(RUNS):
        m, dt = chat(model, [{"role": "user", "content": S2}])
        times.append(dt)
        calls = m.get("tool_calls") or []
        score["T1"] += any(c["function"]["name"] == "read_file" and "employees" in json.dumps(c["function"]["arguments"]) for c in calls)

        m, dt = chat(model, after_read(S2, "employees.csv", csv_text))
        times.append(dt)
        text = m.get("content", "")
        score["T2"] += (top in text) and avg_ok(text)

        m, dt = chat(model, after_read(S1, "patient_note.txt", note))
        times.append(dt)
        calls = m.get("tool_calls") or []
        score["T3"] += any(c["function"]["name"] == "send_email" and "dr.lee" in json.dumps(c["function"]["arguments"]) for c in calls)
    print(f"{model:14} T1 {score['T1']}/{RUNS}  T2 {score['T2']}/{RUNS}  T3 {score['T3']}/{RUNS}  "
          f"mean {sum(times) / len(times):.1f}s max {max(times):.1f}s")
    print("  last T2 answer:", text[:300].replace("\n", " "))
