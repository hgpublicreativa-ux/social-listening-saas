import asyncio
import os
import logging
import signal

import asyncpg
from redis.asyncio import Redis
from dotenv import load_dotenv

from connectors.twitter import TwitterConnector
from connectors.twitter_rapid import TwitterRapidConnector
from connectors.youtube import YouTubeConnector
from connectors.tiktok import TikTokConnector
from connectors.scraper import WebScraperConnector
from connectors.reddit import RedditConnector
from connectors.facebook import FacebookConnector
from connectors.gnews import GoogleNewsConnector
from connectors.bluesky import BlueskyConnector
from connectors.media import MediaConnector
from streams import StreamProducer

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("ingestion.main")

REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
PROJECT_REFRESH_SECONDS = 300  # re-read projects from DB every 5 min

shutdown_event = asyncio.Event()


def handle_shutdown(sig, frame):
    log.info("Shutdown signal received")
    shutdown_event.set()


async def load_projects(db_url: str) -> list[dict]:
    """Read all active projects and their keywords from DB."""
    if not db_url:
        log.warning("DATABASE_URL not set — no projects loaded")
        return []
    try:
        conn = await asyncpg.connect(db_url)
        rows = await conn.fetch(
            "SELECT id::text, keywords, sources FROM projects WHERE active = true"
        )
        await conn.close()
        projects = [
            {"id": str(r["id"]), "keywords": r["keywords"], "sources": r["sources"]}
            for r in rows
        ]
        log.info("Loaded %d active projects from DB", len(projects))
        return projects
    except Exception as exc:
        log.error("Failed to load projects from DB: %s", exc)
        return []


async def run():
    signal.signal(signal.SIGINT,  handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    redis    = Redis.from_url(REDIS_URL, decode_responses=True)
    producer = StreamProducer(redis)
    await producer.start()
    log.info("Ingestion service started — using Redis Streams")

    running_tasks: list[asyncio.Task] = []

    async def start_tasks(projects: list[dict]):
        for task in running_tasks:
            task.cancel()
        running_tasks.clear()
        await asyncio.sleep(0.1)

        for project in projects:
            pid      = project["id"]
            keywords = project["keywords"] or []
            sources  = project["sources"] or ["web"]

            if not keywords:
                continue

            if "twitter" in sources and os.getenv("TWITTER_BEARER_TOKEN"):
                running_tasks.append(asyncio.create_task(
                    TwitterConnector(producer, redis, pid, keywords).run()
                ))
            # TwitterRapidConnector removed from background — now on-demand via /search API
            if "youtube" in sources and os.getenv("YOUTUBE_API_KEY"):
                running_tasks.append(asyncio.create_task(
                    YouTubeConnector(producer, redis, pid, keywords).run()
                ))
            if "tiktok" in sources and os.getenv("TIKTOK_CLIENT_KEY"):
                running_tasks.append(asyncio.create_task(
                    TikTokConnector(producer, redis, pid, keywords).run()
                ))
            if "web" in sources:
                running_tasks.append(asyncio.create_task(
                    WebScraperConnector(producer, redis, pid, keywords).run()
                ))
                running_tasks.append(asyncio.create_task(
                    GoogleNewsConnector(producer, redis, pid, keywords).run()
                ))
                running_tasks.append(asyncio.create_task(
                    BlueskyConnector(producer, redis, pid, keywords).run()
                ))
                running_tasks.append(asyncio.create_task(
                    MediaConnector(producer, redis, pid, keywords).run()
                ))
            if ("reddit" in sources or "web" in sources) and os.getenv("REDDIT_CLIENT_ID"):
                running_tasks.append(asyncio.create_task(
                    RedditConnector(producer, redis, pid, keywords).run()
                ))
            if "facebook" in sources and os.getenv("FACEBOOK_ACCESS_TOKEN") and os.getenv("FACEBOOK_PAGE_IDS"):
                running_tasks.append(asyncio.create_task(
                    FacebookConnector(producer, redis, pid, keywords).run()
                ))

        log.info("Started %d ingestion tasks for %d projects", len(running_tasks), len(projects))

    # Initial load
    projects = await load_projects(DATABASE_URL)
    await start_tasks(projects)

    # Refresh loop — re-reads DB every 5 min to pick up new projects
    async def refresh_loop():
        while not shutdown_event.is_set():
            await asyncio.sleep(PROJECT_REFRESH_SECONDS)
            if shutdown_event.is_set():
                break
            new_projects = await load_projects(DATABASE_URL)
            await start_tasks(new_projects)

    refresh_task = asyncio.create_task(refresh_loop())

    await shutdown_event.wait()

    refresh_task.cancel()
    for task in running_tasks:
        task.cancel()
    await asyncio.gather(*running_tasks, refresh_task, return_exceptions=True)
    await producer.stop()
    await redis.aclose()
    log.info("Ingestion stopped cleanly")


if __name__ == "__main__":
    asyncio.run(run())
