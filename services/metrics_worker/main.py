import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from aiokafka import AIOKafkaConsumer
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("metrics_worker.main")

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
DATABASE_URL    = os.getenv("DATABASE_URL")

engine            = create_async_engine(DATABASE_URL, pool_size=5)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def calc_engagement_rate(metrics: dict, followers: int) -> float:
    if followers == 0:
        return 0.0
    total = metrics.get("likes", 0) + metrics.get("comments", 0) + metrics.get("shares", 0)
    return round(total / followers * 100, 4)


def calc_reach(followers: int, views: int) -> int:
    return max(followers, views)


async def upsert_hourly_metric(session: AsyncSession, project_id: str, platform: str, mention: dict, nlp: dict):
    pub = mention.get("published_at")
    if not pub:
        return

    dt       = datetime.fromisoformat(pub.replace("Z", "+00:00"))
    bucket   = dt.replace(minute=0, second=0, microsecond=0)
    metrics  = mention.get("metrics", {})
    author   = mention.get("author", {})
    followers = author.get("followers", 0)
    sentiment = nlp.get("sentiment", "neutral")
    reach     = calc_reach(followers, metrics.get("views", 0))
    engagement = metrics.get("likes", 0) + metrics.get("comments", 0) + metrics.get("shares", 0)

    await session.execute(text("""
        INSERT INTO metrics_hourly(bucket, project_id, platform, mention_count,
            positive_count, negative_count, neutral_count, total_reach, total_engagement)
        VALUES (:bucket, :project_id, :platform, 1,
            :pos, :neg, :neu, :reach, :engagement)
        ON CONFLICT(bucket, project_id, platform) DO UPDATE SET
            mention_count    = metrics_hourly.mention_count    + 1,
            positive_count   = metrics_hourly.positive_count   + :pos,
            negative_count   = metrics_hourly.negative_count   + :neg,
            neutral_count    = metrics_hourly.neutral_count    + :neu,
            total_reach      = metrics_hourly.total_reach      + :reach,
            total_engagement = metrics_hourly.total_engagement + :engagement
    """), {
        "bucket":     bucket,
        "project_id": project_id,
        "platform":   platform,
        "pos":        1 if sentiment == "positive"  else 0,
        "neg":        1 if sentiment == "negative"  else 0,
        "neu":        1 if sentiment == "neutral"   else 0,
        "reach":      reach,
        "engagement": engagement,
    })


async def update_creator_rank(session: AsyncSession, project_id: str, mention: dict, nlp: dict):
    author    = mention.get("author", {})
    profile_id = author.get("profile_id")
    if not profile_id:
        return

    followers  = author.get("followers", 0)
    metrics    = mention.get("metrics", {})
    engagement = calc_engagement_rate(metrics, followers)

    await session.execute(text("""
        INSERT INTO creator_rankings(project_id, profile_id, period_start, period_end,
            mention_count, total_reach, engagement_rate, influence_score)
        SELECT :project_id, :profile_id,
            date_trunc('week', now()), date_trunc('week', now()) + INTERVAL '7 days',
            1, :reach, :eng, :reach * :eng
        ON CONFLICT(project_id, profile_id, period_start) DO UPDATE SET
            mention_count   = creator_rankings.mention_count + 1,
            total_reach     = creator_rankings.total_reach   + :reach,
            engagement_rate = (:eng + creator_rankings.engagement_rate) / 2,
            influence_score = (creator_rankings.total_reach + :reach) * ((:eng + creator_rankings.engagement_rate) / 2)
    """), {
        "project_id": project_id,
        "profile_id": profile_id,
        "reach":      max(followers, metrics.get("views", 0)),
        "eng":        engagement,
    })


async def run():
    consumer = AIOKafkaConsumer(
        "enriched-mentions",
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id="metrics-workers",
        value_deserializer=lambda v: json.loads(v.decode()),
        auto_offset_reset="latest",
    )
    await consumer.start()
    log.info("Metrics worker started, consuming enriched-mentions")

    try:
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
                    await update_creator_rank(session, project_id, mention, nlp)

    finally:
        await consumer.stop()
        log.info("Metrics worker stopped")


if __name__ == "__main__":
    asyncio.run(run())
