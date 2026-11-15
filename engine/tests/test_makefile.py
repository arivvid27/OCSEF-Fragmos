"""make demo-key, run with a stub python so no engine or venv is needed."""

import stat
import subprocess
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent


def test_a_reminted_demo_key_is_private_whatever_the_umask_and_old_mode(tmp_path):
    stub = tmp_path / "python"
    stub.write_text("#!/bin/sh\necho fk_fresh\n")
    stub.chmod(0o755)
    run = tmp_path / "run"
    run.mkdir()
    key = run / "demo.key"
    key.write_text("fk_stale\n")
    key.chmod(0o644)
    subprocess.run(["sh", "-c", 'umask 022; exec make -s -C "$0" demo-key PY="$1" RUN="$2" SENTINEL_PORT=9',
                    ENGINE, stub, run], check=True, capture_output=True)
    assert key.read_text() == "fk_fresh\n"
    assert stat.S_IMODE(key.stat().st_mode) == 0o600


def test_make_up_starts_probes_and_keys_the_engine_on_one_port():
    planned = subprocess.run(["make", "-n", "-C", ENGINE, "up", "SENTINEL_PORT=18941"], check=True,
                             capture_output=True, text=True).stdout
    assert "8787" not in planned
    assert "env SENTINEL_PORT=18941 .venv/bin/python -m sentinel" in planned
    assert "http://127.0.0.1:18941/health" in planned and "http://127.0.0.1:18941/v1/models" in planned
