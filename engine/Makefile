PY := .venv/bin/python
RUN := .run

.PHONY: setup data up down check test demo env venv

setup:
	test -x $(PY) || ~/.local/bin/python3.11 -m venv .venv
	$(PY) -m pip install -r requirements.txt
	$(PY) -c "import en_core_web_lg" 2>/dev/null || $(PY) -m spacy download en_core_web_lg
	npm --prefix dashboard install

venv:
	@test -x $(PY) || { echo "no .venv: run make setup first"; exit 1; }

env:
	@test -f .env || { echo "missing .env: copy .env.example to .env and set OPENCODE_API_KEY"; exit 1; }
	@grep -Eq '^[[:space:]]*(export[[:space:]]+)?OPENCODE_API_KEY=[^[:space:]]' .env \
		|| { echo ".env has no OPENCODE_API_KEY value"; exit 1; }

data: venv
	$(PY) demo/generate_data.py

# $(1) name, $(2) port, $(3) command. A pidfile whose process is alive means it is already up.
define start
	if [ -f $(RUN)/$(1).pid ] && kill -0 $$(cat $(RUN)/$(1).pid) 2>/dev/null; then echo "$(1) already running"; \
	elif lsof -nP -iTCP:$(2) -sTCP:LISTEN >/dev/null 2>&1; then echo "port $(2) is held by another process"; exit 1; \
	else nohup $(3) </dev/null >$(RUN)/$(1).log 2>&1 & echo $$! >$(RUN)/$(1).pid; echo "started $(1) on :$(2)"; fi
endef

up: venv env
	@mkdir -p $(RUN)
	@$(call start,proxy,8787,$(PY) -m sentinel)
	@$(call start,site,8788,$(PY) demo/site_server.py)
	@$(call start,stub,8789,$(PY) demo/sim_upstream.py)
	@for url in http://127.0.0.1:8787/health http://127.0.0.1:8788/ http://127.0.0.1:8789/health; do \
		for i in $$(seq 120); do curl -sf -o /dev/null $$url && break; sleep 0.5; done; \
		curl -sf -o /dev/null $$url || { echo "$$url did not come up; see $(RUN)/*.log"; exit 1; }; \
	done
	@echo "stack is up (logs in $(RUN)/)"

down:
	@for name in proxy site stub; do \
		if [ -f $(RUN)/$$name.pid ]; then kill $$(cat $(RUN)/$$name.pid) 2>/dev/null && echo "stopped $$name"; \
			rm -f $(RUN)/$$name.pid; fi; \
	done

check: venv
	$(PY) scripts/demo_check.py

test: venv
	.venv/bin/pytest -q

demo: data up
	@echo
	@echo "dashboard  http://127.0.0.1:8787/"
	@echo "events     http://127.0.0.1:8787/api/events"
	@echo
	@echo "scenarios:"
	@echo "  $(PY) demo/agent.py --scenario 1                 health note: REROUTE, then HOLD the email"
	@echo "  $(PY) demo/agent.py --scenario 1b                light note: REDACT names to the cloud"
	@echo "  $(PY) demo/agent.py --scenario 2                 salaries with SSNs: REROUTE to local"
	@echo "  $(PY) demo/agent.py --scenario 3 --vulnerable    prompt injection: BLOCK the exfiltration"
	@echo
	@echo "proof:  make check    stop:  make down"
