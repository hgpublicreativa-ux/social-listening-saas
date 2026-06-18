import asyncio
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from dotenv import load_dotenv

from streams import StreamConsumer

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("alert_engine.main")

REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "").replace("postgresql://", "postgresql+asyncpg://")

engine            = create_async_engine(DATABASE_URL, pool_size=3)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def load_rules(session: AsyncSession, project_id: str) -> list[dict]:
    result = await session.execute(text("""
        SELECT id, project_id, name, trigger_type, threshold, window_minutes, webhook_url, webhook_secret
        FROM alert_rules WHERE active = true AND project_id = :pid
    """), {"pid": project_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def check_spike(redis: Redis, project_id: str, platform: str, threshold: float, window_minutes: int) -> bool:
    key   = f"spike:{project_id}:{platform}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window_minutes * 60)
    return count >= threshold


async def dispatch_webhook(client: httpx.AsyncClient, session: AsyncSession, rule: dict, payload: dict):
    url = rule.get("webhook_url")
    if not url:
        return
    body    = json.dumps(payload, default=str).encode()
    headers = {"Content-Type": "application/json", "X-Alert-Type": rule["trigger_type"]}
    if rule.get("webhook_secret"):
        headers["X-Signature"] = "sha256=" + hmac.new(rule["webhook_secret"].encode(), body, hashlib.sha256).hexdigest()

    try:
        r         = await client.post(url, content=body, headers=headers, timeout=10)
        delivered = r.status_code < 400
        error     = None if delivered else f"HTTP {r.status_code}"
    except Exception as exc:
        delivered = False
        error     = str(exc)

    await session.execute(text("""
        INSERT INTO alert_events(rule_id, triggered_at, current_value, payload, delivered, delivered_at, error)
        VALUES (:rid, :ts, :val, :payload, :delivered, :dat, :error)
    """), {
        "rid":       rule["id"],
        "ts":        datetime.now(timezone.utc),
        "val":       payload.get("current_value"),
        "payload":   json.dumps(payload, default=str),
        "delivered": delivered,
        "dat":       datetime.now(timezone.utc) if delivered else None,
        "error":     error,
    })
    log.info("Webhook %s: rule=%s", "OK" if delivered else "FAIL", rule["name"])


async def run():
    redis    = Redis.from_url(REDIS_URL, decode_responses=True)
    consumer = StreamConsumer(redis, "enriched-mentions", "alert-engine", "alert-1")
    await consumer.start()
    log.info("Alert engine started — consuming enriched-mentions via Redis Streams")

    async with httpx.AsyncClient() as http_client:
        async for msg in consumer:
            envelope   = msg.value
            mention    = envelope.get("raw", {})
            nlp        = envelope.get("nlp", {})
            project_id = mention.get("project_id")
            platform   = mention.get("platform")
            if not project_id:
                continue

            async with AsyncSessionLocal() as session:
                async with session.begin():
                    rules = await load_rules(session, project_id)
                    for rule in rules:
                        fired = False
                        value = 0

                        if rule["trigger_type"] == "spike":
                            fired = await check_spike(redis, project_id, platform,
                                                      rule["threshold"], rule["window_minutes"])
                            value = rule["threshold"]
                        elif rule["trigger_type"] == "sentiment_drop":
                            if nlp.get("sentiment") == "negative" and nlp.get("sentiment_score", 0) > 0.85:
                                fired = True
                                value = nlp["sentiment_score"]
                        elif rule["trigger_type"] == "keyword_hit":
                            kws = [kw.lower() for kw in nlp.get("keywords", [])]
                            if any(kw in (mention.get("content_text") or "").lower() for kw in kws):
                                fired = True
                                value = 1

                        if fired:
                            await dispatch_webhook(http_client, session, rule, {
                                "alert_name":    rule["name"],
                                "trigger_type":  rule["trigger_type"],
                                "project_id":    project_id,
                                "platform":      platform,
                                "current_value": value,
                                "mention": {
                                    "id":           mention.get("id"),
                                    "text":         (mention.get("content_text") or "")[:200],
                                    "url":          mention.get("content_url"),
                                    "sentiment":    nlp.get("sentiment"),
                                    "published_at": mention.get("published_at"),
                                },
                                "fired_at": datetime.now(timezone.utc).isoformat(),
                            })

    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(run())
