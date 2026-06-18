import asyncio
import os
import json
import logging
import signal
from datetime import datetime, timezone

from aiokafka import AIOKafkaProducer
from redis.asyncio import Redis
from dotenv import load_dotenv

from connectors.twitter import TwitterConnector
from connectors.youtube import YouTubeConnector
from connectors.tiktok import TikTokConnector
from connectors.scraper import WebScraperConnector
from utils.kafka import kafka_config

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("ingestion.main")

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
REDIS_URL       = os.getenv("REDIS_URL", "redis://localhost:6379")

# Projects to monitor — in production, load from PostgreSQL via API
DEMO_PROJECTS = [
    {
        "id": "demo-project-001",
        "keywords": ["Bad Bunny", "reggaeton", "Latin Grammy", "música urbana"],
        "sources": ["twitter", "youtube", "web"],
        "language": "es",
    }
]

shutdown_event = asyncio.Event()


def handle_shutdown(sig, frame):
    log.info("Shutdown signal received")
    shutdown_event.set()


async def run():
    signal.signal(signal.SIGINT,  handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    redis = Redis.from_url(REDIS_URL, decode_responses=True)

    producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode(),
        compression_type="gzip",
        acks="all",
        **kafka_config(),
    )
    await producer.start()
    log.info("Kafka producer connected to %s", KAFKA_BOOTSTRAP)

    tasks = []
    for project in DEMO_PROJECTS:
        pid      = project["id"]
        keywords = project["keywords"]
        sources  = project["sources"]

        if "twitter" in sources:
            conn = TwitterConnector(producer, redis, pid, keywords)
            tasks.append(asyncio.create_task(conn.run(), name=f"twitter:{pid}"))

        if "youtube" in sources:
            conn = YouTubeConnector(producer, redis, pid, keywords)
            tasks.append(asyncio.create_task(conn.run(), name=f"youtube:{pid}"))

        if "tiktok" in sources:
            conn = TikTokConnector(producer, redis, pid, keywords)
            tasks.append(asyncio.create_task(conn.run(), name=f"tiktok:{pid}"))

        if "web" in sources:
            conn = WebScraperConnector(producer, redis, pid, keywords)
            tasks.append(asyncio.create_task(conn.run(), name=f"web:{pid}"))

    log.info("Started %d ingestion tasks", len(tasks))
    await shutdown_event.wait()

    for task in tasks:
        task.cancel()

    await asyncio.gather(*tasks, return_exceptions=True)
    await producer.stop()
    await redis.aclose()
    log.info("Ingestion service stopped cleanly")


if __name__ == "__main__":
    asyncio.run(run())
