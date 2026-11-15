RUN := engine/.run
WEB_PORT := 3000

.PHONY: setup demo down test check

include engine/run.mk

setup:
	$(MAKE) -C engine setup
	npm --prefix fragmos ci

demo:
	$(MAKE) -C engine demo
	@$(call start,web,$(WEB_PORT),sh -c 'cd fragmos && npm run build && exec node_modules/.bin/next start -H 127.0.0.1 -p $(WEB_PORT)')
	@for i in $$(seq 240); do curl -sf -o /dev/null http://127.0.0.1:$(WEB_PORT)/monitor && break; sleep 0.5; done; \
		curl -sf -o /dev/null http://127.0.0.1:$(WEB_PORT)/monitor || { echo "the web app did not come up; see $(RUN)/web.log"; exit 1; }
	@echo
	@echo "workspace  http://127.0.0.1:$(WEB_PORT)/"
	@echo "monitor    http://127.0.0.1:$(WEB_PORT)/monitor"
	@echo "run the scenarios above from engine/"

down:
	@$(call stop,web)
	$(MAKE) -C engine down

test:
	$(MAKE) -C engine test
	npm --prefix fragmos test

check:
	$(MAKE) -C engine check
