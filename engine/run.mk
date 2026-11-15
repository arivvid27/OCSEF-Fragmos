# Pidfile process control, shared with the root Makefile. Set RUN to the pidfile directory first.

# $(1) name, $(2) port, $(3) command. A pidfile whose process is alive means it is already up.
define start
	if [ -f $(RUN)/$(1).pid ] && kill -0 $$(cat $(RUN)/$(1).pid) 2>/dev/null; then echo "$(1) already running"; \
	elif lsof -nP -iTCP:$(2) -sTCP:LISTEN >/dev/null 2>&1; then echo "port $(2) is held by another process"; exit 1; \
	else nohup $(3) </dev/null >$(RUN)/$(1).log 2>&1 & echo $$! >$(RUN)/$(1).pid; echo "started $(1) on :$(2)"; fi
endef

# $(1) names to stop.
define stop
	for name in $(1); do \
		if [ -f $(RUN)/$$name.pid ]; then kill $$(cat $(RUN)/$$name.pid) 2>/dev/null && echo "stopped $$name"; \
			rm -f $(RUN)/$$name.pid; fi; \
	done
endef
