import asyncio
import json
import logging
import os

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from dotenv import load_dotenv

from streams import StreamConsumer

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("metrics_worker.main")

REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "").replace("postgresql://", "postgresql+asyncpg://")

engine            = create_async_engine(DATABASE_URL, pool_size=5)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def calc_engagement_rate(metrics: dict, followers: int) -> float:
    if followers == 0:
        return 0.0
    total = metrics.get("likes", 0) + metrics.get("comments", 0) + metrics.get("shares", 0)
    return round(total / followers * 100, 4)


async def upsert_hourly_metric(session: AsyncSession, project_id: str, platform: str, mention: dict, nlp: dict):
    pub = mention.get("published_at")
    if not pub:
        return
    from datetime import datetime, timezone
    dt        = datetime.fromisoformat(pub.replace("Z", "+00:00"))
    bucket    = dt.replace(minute=0, second=0, microsecond=0)
    metrics   = mention.get("metrics", {})
    author    = mention.get("author", {})
    followers = author.get("followers", 0)
    sentiment = nlp.get("sentiment", "neutral")
    reach     = max(followers, metrics.get("views", 0))
    engagement = metrics.get("likes", 0) + metrics.get("comments", 0) + metrics.get("shares", 0)

    await session.execute(text("""
        INSERT INTO metrics_hourly(bucket, project_id, platform, mention_count,
            positive_count, negative_count, neutral_count, total_reach, total_engagement)
        VALUES (:bucket, :pid, :platform, 1, :pos, :neg, :neu, :reach, :engagement)
        ON CONFLICT(bucket, project_id, platform) DO UPDATE SET
            mention_count    = metrics_hourly.mention_count    + 1,
            positive_count   = metrics_hourly.positive_count   + :pos,
            negative_count   = metrics_hourly.negative_count   + :neg,
            neutral_count    = metrics_hourly.neutral_count    + :neu,
            total_reach      = metrics_hourly.total_reach      + :reach,
            total_engagement = metrics_hourly.total_engagement + :engagement
    """), {
        "bucket": bucket, "pid": project_id, "platform": platform,
        "pos": 1 if sentiment == "positive" else 0,
        "neg": 1 if sentiment == "negative" else 0,
        "neu": 1 if sentiment == "neutral"  else 0,
        "reach": reach, "engagement": engagement,
    })


async def run():
    redis    = Redis.from_url(REDIS_URL, decode_responses=True)
    consumer = StreamConsumer(redis, "enriched-mentions", "metrics-workers", "metrics-1")
    await consumer.start()
    log.info("Metrics worker started — consuming enriched-mentions via Redis Streams")

    async for msg in consumer:
        envelope   = msg.value
        mention    = envelope.get("raw", {})
        nlp        = envelope.get("nlp", {})
        project_id = mention.get("project_id")
        platform   = mention.get("platform")

        if not project_id or not platform:
            continue

        async with AsyncSessionLocal() as session:
            async with session.begin():
                await upsert_hourly_metric(session, project_id, platform, mention, nlp)

    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(run())
