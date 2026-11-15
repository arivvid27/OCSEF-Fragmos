import uvicorn
from dotenv import load_dotenv

from sentinel.app import ROOT, create_app

load_dotenv(ROOT / ".env")
uvicorn.run(create_app(), host="127.0.0.1", port=8787)
