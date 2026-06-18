import asyncio
import json
import logging
import os
import uuid

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from dotenv import load_dotenv

from streams import StreamConsumer, StreamProducer
from processor import process_mention

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("nlp_worker.main")

REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "").replace("postgresql://", "postgresql+asyncpg://")

engine            = create_async_engine(DATABASE_URL, pool_size=5)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def upsert_profile(session: AsyncSession, author: dict, platform: str) -> str | None:
    if not author.get("platform_id") and not author.get("username"):
        return None
    platform_id = author.get("platform_id") or author.get("username")
    q = await session.execute(text("""
        INSERT INTO social_profiles(platform, platform_id, username, display_name, followers, verified)
        VALUES (:platform, :pid, :uname, :dname, :followers, :verified)
        ON CONFLICT(platform, platform_id) DO UPDATE SET
            username     = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            followers    = EXCLUDED.followers,
            updated_at   = now()
        RETURNING id
    """), {
        "platform":  platform,
        "pid":       platform_id,
        "uname":     author.get("username"),
        "dname":     author.get("display_name"),
        "followers": author.get("followers", 0),
        "verified":  author.get("verified", False),
    })
    row = q.fetchone()
    return str(row[0]) if row else None


async def save_mention(session: AsyncSession, mention: dict, nlp: dict, profile_id: str | None):
    await session.execute(text("""
        INSERT INTO mentions(
            id, project_id, profile_id, platform, platform_post_id,
            content_text, content_url, language, published_at,
            sentiment, sentiment_score, keywords, entities, summary, nlp_tier,
            likes, shares, comments, views
        ) VALUES (
            :id, :project_id, :profile_id, :platform, :post_id,
            :text, :url, :lang, :published_at,
            :sentiment, :sentiment_score, :keywords, :entities, :summary, :tier,
            :likes, :shares, :comments, :views
        )
        ON CONFLICT(platform, platform_post_id) DO NOTHING
    """), {
        "id":              mention.get("id", str(uuid.uuid4())),
        "project_id":      mention["project_id"],
        "profile_id":      profile_id,
        "platform":        mention["platform"],
        "post_id":         mention["platform_post_id"],
        "text":            mention.get("content_text"),
        "url":             mention.get("content_url"),
        "lang":            mention.get("language", "es"),
        "published_at":    mention.get("published_at"),
        "sentiment":       nlp.get("sentiment"),
        "sentiment_score": nlp.get("sentiment_score"),
        "keywords":        nlp.get("keywords", []),
        "entities":        json.dumps(nlp.get("entities", [])),
        "summary":         nlp.get("summary"),
        "tier":            nlp.get("nlp_tier", "local"),
        "likes":           mention.get("metrics", {}).get("likes", 0),
        "shares":          mention.get("metrics", {}).get("shares", 0),
        "comments":        mention.get("metrics", {}).get("comments", 0),
        "views":           mention.get("metrics", {}).get("views", 0),
    })


async def run():
    redis    = Redis.from_url(REDIS_URL, decode_responses=True)
    consumer = StreamConsumer(redis, "raw-mentions", "nlp-workers", "nlp-1")
    producer = StreamProducer(redis)
    await consumer.start()

    log.info("NLP worker started — consuming raw-mentions via Redis Streams")

    async for msg in consumer:
        envelope = msg.value
        mention  = envelope.get("raw", {})

        if not mention.get("platform_post_id"):
            continue

        mention["id"] = str(uuid.uuid4())

        try:
            nlp = await process_mention(redis, mention)
        except Exception as exc:
            log.error("NLP processing failed: %s", exc)
            continue

        async with AsyncSessionLocal() as session:
            async with session.begin():
                profile_id = await upsert_profile(session, mention.get("author", {}), mention["platform"])
                await save_mention(session, mention, nlp, profile_id)

        enriched = {**envelope, "raw": {**mention}, "nlp": nlp}
        await producer.send("enriched-mentions", value=enriched)

        # Publish to Redis pubsub for WebSocket feed
        await redis.publish(f"mentions:{mention['project_id']}", json.dumps({
            "platform":    mention["platform"],
            "text":        (mention.get("content_text") or "")[:200],
            "sentiment":   nlp.get("sentiment"),
            "published_at": mention.get("published_at"),
        }))

    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(run())
