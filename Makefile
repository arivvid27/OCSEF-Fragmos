RUN := engine/.run
WEB_PORT := 3000
WEBUI_PORT := 8080
WEBUI_KEY := $(RUN)/openwebui.key
FRAGMOS_ENGINE_URL ?= http://127.0.0.1:8787/v1
FRAGMOS_CHAT_MODEL ?= cloud
# The interpreter that creates the venvs: the pinned 3.11 when present, else the newest python3 on PATH.
PYTHON ?= $(or $(wildcard $(HOME)/.local/bin/python3.11),$(shell command -v python3.11 || command -v python3))

.PHONY: setup demo down test check webui

include engine/run.mk

setup:
	$(MAKE) -C engine setup PYTHON=$(PYTHON)
	npm --prefix fragmos ci
	test -x webui/.venv/bin/python || $(PYTHON) -m venv webui/.venv
	webui/.venv/bin/python -m pip install --timeout 120 --retries 10 -r webui/requirements.txt

demo:
	$(MAKE) -C engine demo
	@$(call start,web,$(WEB_PORT),sh -c 'cd fragmos && npm run build && exec node_modules/.bin/next start -H 127.0.0.1 -p $(WEB_PORT)')
	@for i in $$(seq 240); do curl -sf -o /dev/null http://127.0.0.1:$(WEB_PORT)/monitor && break; sleep 0.5; done; \
		curl -sf -o /dev/null http://127.0.0.1:$(WEB_PORT)/monitor || { echo "the web app did not come up; see $(RUN)/web.log"; exit 1; }
	@$(MAKE) --no-print-directory webui
	@echo
	@echo "workspace  http://127.0.0.1:$(WEB_PORT)/"
	@echo "monitor    http://127.0.0.1:$(WEB_PORT)/monitor"
	@echo "chat       http://127.0.0.1:$(WEBUI_PORT)/"
	@echo "run the scenarios above from engine/"

# Open WebUI reads its engine key only at launch, so minting a key restarts it.
webui:
	@test -x webui/.venv/bin/open-webui || { echo "no webui/.venv: run make setup first"; exit 1; }
	@mkdir -p $(RUN)
	@code=$$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $$(cat $(WEBUI_KEY) 2>/dev/null)" $(FRAGMOS_ENGINE_URL)/models); \
	if [ ! -s $(WEBUI_KEY) ] || [ "$$code" = 401 ]; then umask 077; \
		(cd engine && .venv/bin/python -m sentinel keys create openwebui) >$(WEBUI_KEY).new && mv $(WEBUI_KEY).new $(WEBUI_KEY) \
			&& echo "minted gateway key openwebui into $(WEBUI_KEY)" || { echo "could not mint the openwebui key"; exit 1; }; \
		$(webui_stop); \
	fi
	@$(webui_start)
# The start that creates the admin turns signup off until the next start.
	@curl -s http://127.0.0.1:$(WEBUI_PORT)/api/config | grep -q '"enable_signup":true' || { $(webui_stop); $(webui_start); }

webui_start = $(call start,webui,$(WEBUI_PORT),env PORT=$(WEBUI_PORT) FRAGMOS_ENGINE_URL=$(FRAGMOS_ENGINE_URL) FRAGMOS_KEY_FILE=$(WEBUI_KEY) FRAGMOS_CHAT_MODEL=$(FRAGMOS_CHAT_MODEL) webui/serve.sh); \
	for i in $$(seq 240); do curl -sf -o /dev/null http://127.0.0.1:$(WEBUI_PORT)/health && break; sleep 0.5; done; \
	curl -sf -o /dev/null http://127.0.0.1:$(WEBUI_PORT)/health || { echo "Open WebUI did not come up; see $(RUN)/webui.log"; exit 1; }
webui_stop = $(call stop,webui); for i in $$(seq 100); do lsof -nP -iTCP:$(WEBUI_PORT) -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.2; done

down:
	@$(call stop,web webui)
	$(MAKE) -C engine down

test:
	$(MAKE) -C engine test
	npm --prefix fragmos test

check:
	$(MAKE) -C engine check
