from pathlib import Path
import sys

from workers import WorkerEntrypoint
import asgi

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from main import app


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        scope = {"env": self.env}
        return await asgi.fetch(app, request, scope)
