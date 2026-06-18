import asyncio
import os
import logging
import signal

from redis.asyncio import Redis
from dotenv import load_dotenv

from connectors.twitter import TwitterConnector
from connectors.youtube import YouTubeConnector
from connectors.tiktok import TikTokConnector
from connectors.scraper import WebScraperConnector
from streams import StreamProducer

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("ingestion.main")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

DEMO_PROJECTS = [
    {
        "id": "demo-project-001",
        "keywords": ["Bad Bunny", "reggaeton", "Latin Grammy", "música urbana"],
        "sources": ["twitter", "youtube", "web"],
    }
]

shutdown_event = asyncio.Event()


def handle_shutdown(sig, frame):
    log.info("Shutdown signal received")
    shutdown_event.set()


async def run():
    signal.signal(signal.SIGINT,  handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    redis    = Redis.from_url(REDIS_URL, decode_responses=True)
    producer = StreamProducer(redis)
    await producer.start()
    log.info("Ingestion service started — using Redis Streams")

    tasks = []
    for project in DEMO_PROJECTS:
        pid      = project["id"]
        keywords = project["keywords"]
        sources  = project["sources"]

        if "twitter" in sources:
            tasks.append(asyncio.create_task(TwitterConnector(producer, redis, pid, keywords).run()))
        if "youtube" in sources:
            tasks.append(asyncio.create_task(YouTubeConnector(producer, redis, pid, keywords).run()))
        if "tiktok" in sources:
            tasks.append(asyncio.create_task(TikTokConnector(producer, redis, pid, keywords).run()))
        if "web" in sources:
            tasks.append(asyncio.create_task(WebScraperConnector(producer, redis, pid, keywords).run()))

    log.info("Started %d ingestion tasks", len(tasks))
    await shutdown_event.wait()

    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await producer.stop()
    await redis.aclose()
    log.info("Ingestion stopped cleanly")


if __name__ == "__main__":
    asyncio.run(run())
