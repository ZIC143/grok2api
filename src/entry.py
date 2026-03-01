from workers import WorkerEntrypoint
import asgi

from main import app


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        scope = {"env": self.env}
        return await asgi.fetch(app, request, scope)
