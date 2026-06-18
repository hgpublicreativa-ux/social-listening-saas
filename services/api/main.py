import logging
import os
import asyncpg

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from redis.asyncio import Redis

from routers import auth, projects, mentions, metrics, alerts, search

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api.main")


async def run_migrations():
    db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
    if not db_url:
        log.warning("DATABASE_URL not set — skipping migrations")
        return
    try:
        conn = await asyncpg.connect(db_url)
        migration_dir = os.path.join(os.path.dirname(__file__), "migrations")
        if not os.path.isdir(migration_dir):
            log.warning("No migrations directory found")
            await conn.close()
            return
        for fname in sorted(os.listdir(migration_dir)):
            if fname.endswith(".sql"):
                sql = open(os.path.join(migration_dir, fname)).read()
                try:
                    await conn.execute(sql)
                    log.info("Applied migration: %s", fname)
                except Exception as exc:
                    log.warning("Migration %s skipped/partial: %s", fname, str(exc)[:120])
        await conn.close()
    except Exception as exc:
        log.error("Migration runner error: %s", exc)

app = FastAPI(
    title="Social Listening API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

FRONTEND_URL = os.getenv("FRONTEND_URL", "")
origins = ["http://localhost:3000", "http://localhost:5173"]
if FRONTEND_URL:
    origins.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await run_migrations()

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(mentions.router)
app.include_router(metrics.router)
app.include_router(alerts.router)
app.include_router(search.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


# WebSocket: real-time mention feed per project
class ConnectionManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}

    async def connect(self, project_id: str, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(project_id, []).append(ws)

    def disconnect(self, project_id: str, ws: WebSocket):
        if project_id in self.active:
            self.active[project_id].remove(ws)

    async def broadcast(self, project_id: str, data: dict):
        for ws in list(self.active.get(project_id, [])):
            try:
                await ws.send_json(data)
            except Exception:
                pass


manager = ConnectionManager()


@app.websocket("/ws/{project_id}")
async def websocket_feed(project_id: str, ws: WebSocket):
    await manager.connect(project_id, ws)
    redis = Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), decode_responses=True)

    try:
        async with redis.pubsub() as pubsub:
            await pubsub.subscribe(f"mentions:{project_id}")
            async for message in pubsub.listen():
                if message["type"] == "message":
                    await ws.send_text(message["data"])
    except WebSocketDisconnect:
        manager.disconnect(project_id, ws)
    finally:
        await redis.aclose()
