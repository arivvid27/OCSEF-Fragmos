"""python -m sentinel                      serve on 127.0.0.1, port SENTINEL_PORT (8787)
python -m sentinel keys create <name>   mint a gateway key in the server's database and print only the key

SENTINEL_DB moves the database for both, so a key minted here works on the server that reads the same file.
"""

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from sentinel.store import DEFAULT_DB, KEY_NAME_MAX, Store


def key_name(raw: str) -> str:
    if not 0 < len(raw.strip()) <= KEY_NAME_MAX:
        raise argparse.ArgumentTypeError(f"a key name is 1 to {KEY_NAME_MAX} characters")
    return raw.strip()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m sentinel")
    commands = parser.add_subparsers(dest="command")
    keys = commands.add_parser("keys", help="manage gateway keys").add_subparsers(dest="action", required=True)
    keys.add_parser("create", help="mint a key and print it").add_argument("name", type=key_name)
    args = parser.parse_args()
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    db = Path(os.environ.get("SENTINEL_DB") or DEFAULT_DB)
    if args.command == "keys":
        _, key = Store(db).create_key(args.name)
        print(key)
        return

    import uvicorn  # the server's imports load Presidio, which a key command does not need

    from sentinel.app import create_app

    uvicorn.run(create_app(db_path=db), host="127.0.0.1", port=int(os.environ.get("SENTINEL_PORT") or 8787))


if __name__ == "__main__":
    main()
