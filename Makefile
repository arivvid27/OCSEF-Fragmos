RUN := engine/.run
WEB_PORT := 3000
WEBUI_PORT := 8080
WEBUI_KEY := $(RUN)/openwebui.key

.PHONY: setup demo down test check webui

include engine/run.mk

setup:
	$(MAKE) -C engine setup
	npm --prefix fragmos ci
	test -x webui/.venv/bin/python || ~/.local/bin/python3.11 -m venv webui/.venv
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

webui:
	@test -x webui/.venv/bin/open-webui || { echo "no webui/.venv: run make setup first"; exit 1; }
	@mkdir -p $(RUN)
	@test -s $(WEBUI_KEY) || { umask 077; (cd engine && .venv/bin/python -m sentinel keys create openwebui) >$(WEBUI_KEY).new \
		&& mv $(WEBUI_KEY).new $(WEBUI_KEY) && echo "minted engine key openwebui"; } \
		|| { echo "could not mint the openwebui key"; exit 1; }
	@$(call start,webui,$(WEBUI_PORT),env PORT=$(WEBUI_PORT) FRAGMOS_KEY_FILE=$(WEBUI_KEY) webui/serve.sh)
	@for i in $$(seq 240); do curl -sf -o /dev/null http://127.0.0.1:$(WEBUI_PORT)/health && break; sleep 0.5; done; \
		curl -sf -o /dev/null http://127.0.0.1:$(WEBUI_PORT)/health || { echo "Open WebUI did not come up; see $(RUN)/webui.log"; exit 1; }

down:
	@$(call stop,web webui)
	$(MAKE) -C engine down

test:
	$(MAKE) -C engine test
	npm --prefix fragmos test

check:
	$(MAKE) -C engine check
