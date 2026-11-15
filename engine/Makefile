PY := .venv/bin/python
RUN := .run
SENTINEL_PORT ?= 8787
# The interpreter that creates .venv: the pinned 3.11 when present, else the newest python3 on PATH.
PYTHON ?= $(or $(wildcard $(HOME)/.local/bin/python3.11),$(shell command -v python3.11 || command -v python3))

.PHONY: setup data up down check test demo demo-key env venv

setup:
	test -x $(PY) || $(PYTHON) -m venv .venv
	$(PY) -m pip install -r requirements.txt
	$(PY) -c "import en_core_web_lg" 2>/dev/null || $(PY) -m spacy download en_core_web_lg
	$(PY) -c "from huggingface_hub import snapshot_download; from sentinel.presidio_detector import NAMES_BASE, NAMES_REVISION; \
		snapshot_download(NAMES_BASE, revision=NAMES_REVISION)"

venv:
	@test -x $(PY) || { echo "no .venv: run make setup first"; exit 1; }

env:
	@test -f .env || { echo "missing .env: copy .env.example to .env and set OPENCODE_API_KEY"; exit 1; }
	@grep -Eq '^[[:space:]]*(export[[:space:]]+)?OPENCODE_API_KEY=[^[:space:]]' .env \
		|| { echo ".env has no OPENCODE_API_KEY value"; exit 1; }

data: venv
	$(PY) demo/generate_data.py

include run.mk

up: venv env
	@mkdir -p $(RUN)
	@$(call start,proxy,$(SENTINEL_PORT),env SENTINEL_PORT=$(SENTINEL_PORT) $(PY) -m sentinel)
	@$(call start,site,8788,$(PY) demo/site_server.py)
	@$(call start,stub,8789,$(PY) demo/sim_upstream.py)
	@for url in http://127.0.0.1:$(SENTINEL_PORT)/health http://127.0.0.1:8788/ http://127.0.0.1:8789/health; do \
		for i in $$(seq 120); do curl -sf -o /dev/null $$url && break; sleep 0.5; done; \
		curl -sf -o /dev/null $$url || { echo "$$url did not come up; see $(RUN)/*.log"; exit 1; }; \
	done
	@$(MAKE) --no-print-directory demo-key
	@echo "stack is up (logs in $(RUN)/)"

demo-key:
	@curl -sf -o /dev/null -H "x-api-key: $$(cat $(RUN)/demo.key 2>/dev/null)" http://127.0.0.1:$(SENTINEL_PORT)/v1/models \
		|| { (umask 077; rm -f $(RUN)/demo.key && $(PY) -m sentinel keys create demo >$(RUN)/demo.key) && echo "minted gateway key demo into $(RUN)/demo.key"; }

down:
	@$(call stop,proxy site stub)

check: venv
	$(PY) scripts/demo_check.py

test: venv
	.venv/bin/pytest -q

demo: data up
	@echo
	@echo "events     http://127.0.0.1:$(SENTINEL_PORT)/api/events"
	@echo "monitor    make demo from the repository root serves it at http://127.0.0.1:3000/monitor"
	@echo
	@echo "scenarios:"
	@echo "  $(PY) demo/agent.py --scenario 1                 health note: REROUTE, then HOLD the email"
	@echo "  $(PY) demo/agent.py --scenario 1b                light note: REDACT names to the cloud"
	@echo "  $(PY) demo/agent.py --scenario 2                 salaries with SSNs: REROUTE to local"
	@echo "  $(PY) demo/agent.py --scenario 3 --vulnerable    prompt injection: BLOCK the exfiltration"
	@echo
	@echo "proof:  make check    stop:  make down"
