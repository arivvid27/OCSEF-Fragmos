#!/bin/sh
# Open WebUI as a ChatGPT-style front end whose only model provider is the Fragmos engine.
# env -i keeps the caller's OPENAI_* or OLLAMA_* variables from adding a connection that skips the engine.
# ENABLE_PERSISTENT_CONFIG=False makes these values win over what an earlier boot saved in data/.
# The chat id goes out as x-sentinel-session, so each chat is one engine session with its own vault.
# OFFLINE_MODE stops the version check and Hugging Face downloads. An empty RAG_EMBEDDING_MODEL skips loading one.
# Only the admin can change the provider, so the admin's password is random, kept in data/, and not needed for the demo.
# Everyone else signs up as role user, which cannot reach the connection settings.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
port=${PORT:-8080}
engine=${FRAGMOS_ENGINE_URL:-http://127.0.0.1:8787/v1}
model=${FRAGMOS_CHAT_MODEL:-cloud}
key_file=${FRAGMOS_KEY_FILE:-$here/../engine/.run/openwebui.key}
data=${DATA_DIR:-$here/data}

test -s "$key_file" || { echo "no engine key at $key_file: run make webui from the repository root" >&2; exit 1; }
key=$(cat "$key_file")
mkdir -p "$data"
cd "$data"  # open-webui serve writes .webui_secret_key to the working directory
data=$PWD
admin_password_file=$data/admin.password
test -s "$admin_password_file" || (umask 077; "$here/.venv/bin/python" -c 'import secrets; print(secrets.token_urlsafe(24))' >"$admin_password_file")

exec env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
	DATA_DIR="$data" \
	ENABLE_PERSISTENT_CONFIG=False \
	WEBUI_AUTH=True \
	WEBUI_ADMIN_EMAIL=admin@localhost \
	WEBUI_ADMIN_PASSWORD="$(cat "$admin_password_file")" \
	WEBUI_ADMIN_NAME="Fragmos admin" \
	ENABLE_SIGNUP=True \
	DEFAULT_USER_ROLE=user \
	BYPASS_MODEL_ACCESS_CONTROL=True \
	CORS_ALLOW_ORIGIN="http://127.0.0.1:$port;http://localhost:$port" \
	ENABLE_OLLAMA_API=False \
	OPENAI_API_BASE_URLS="$engine" \
	OPENAI_API_KEYS="$key" \
	DEFAULT_MODELS="$model" \
	ENABLE_FORWARD_USER_INFO_HEADERS=True \
	FORWARD_SESSION_INFO_HEADER_CHAT_ID=x-sentinel-session \
	ENABLE_TITLE_GENERATION=False \
	ENABLE_TAGS_GENERATION=False \
	ENABLE_FOLLOW_UP_GENERATION=False \
	ENABLE_AUTOCOMPLETE_GENERATION=False \
	ENABLE_SEARCH_QUERY_GENERATION=False \
	ENABLE_RETRIEVAL_QUERY_GENERATION=False \
	OFFLINE_MODE=True \
	RAG_EMBEDDING_MODEL= \
	"$here/.venv/bin/open-webui" serve --host 127.0.0.1 --port "$port"
