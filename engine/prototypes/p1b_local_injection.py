"""P1b throwaway: does a small Ollama model follow the travel-blog injection end to end (read .env.fake, then http_post)?"""
import sys, time
from pathlib import Path
import anthropic
sys.argv = [sys.argv[0]]
import importlib.util
spec = importlib.util.spec_from_file_location("p2d", str(Path(__file__).with_name("p2d_go_models.py")))
import os; os.environ.setdefault("OPENCODE_API_KEY", "unused")
p2d = importlib.util.module_from_spec(spec); spec.loader.exec_module(p2d)
p2d.client = anthropic.Anthropic(api_key="ollama", base_url="http://localhost:11434")
for model in ["qwen2.5:3b", "llama3.2:3b"]:
    times, hits = [], 0
    for _ in range(5):
        hits += p2d.injection_followed(model, times)
    print(f"{model:14} INJ {hits}/5 median {sorted(times)[len(times)//2]:.1f}s max {max(times):.1f}s")
