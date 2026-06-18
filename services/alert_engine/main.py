import asyncio
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from aiokafka import AIOKafkaConsumer
from kafka import kafka_config
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("alert_engine.main")

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
REDIS_URL       = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL    = os.getenv("DATABASE_URL")

engine            = create_async_engine(DATABASE_URL, pool_size=3)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Spike: mention count in rolling window exceeds threshold
SPIKE_WINDOW_SECONDS = 3600  # 1 hour


async def load_rules(session: AsyncSession) -> list[dict]:
    result = await session.execute(text("""
        SELECT r.id, r.project_id, r.name, r.trigger_type, r.threshold,
               r.window_minutes, r.webhook_url, r.webhook_secret
        FROM alert_rules r
        WHERE r.active = true
    """))
    return [dict(row._mapping) for row in result.fetchall()]


async def check_spike(redis: Redis, project_id: str, platform: str, threshold: float, window_minutes: int) -> bool:
    key = f"spike:{project_id}:{platform}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window_minutes * 60)
    return count >= threshold


async def sign_payload(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def dispatch_webhook(client: httpx.AsyncClient, session: AsyncSession, rule: dict, payload: dict):
    url = rule.get("webhook_url")
    if not url:
        return

    body = json.dumps(payload, default=str).encode()
    headers = {
        "Content-Type":   "application/json",
        "X-Alert-Source": "social-listening",
        "X-Alert-Type":   rule["trigger_type"],
    }
    if rule.get("webhook_secret"):
        headers["X-Signature"] = await sign_payload(rule["webhook_secret"], body)

    try:
        r = await client.post(url, content=body, headers=headers, timeout=10)
        delivered = r.status_code < 400
        error     = None if delivered else f"HTTP {r.status_code}"
    except Exception as exc:
        delivered = False
        error     = str(exc)

    await session.execute(text("""
        INSERT INTO alert_events(rule_id, triggered_at, current_value, payload, delivered, delivered_at, error)
        VALUES (:rule_id, :triggered_at, :current_value, :payload, :delivered, :delivered_at, :error)
    """), {
        "rule_id":       rule["id"],
        "triggered_at":  datetime.now(timezone.utc),
        "current_value": payload.get("current_value"),
        "payload":       json.dumps(payload, default=str),
        "delivered":     delivered,
        "delivered_at":  datetime.now(timezone.utc) if delivered else None,
        "error":         error,
    })

    if delivered:
        log.info("Webhook delivered: rule=%s type=%s", rule["name"], rule["trigger_type"])
    else:
        log.warning("Webhook failed: rule=%s error=%s", rule["name"], error)


async def run():
    redis    = Redis.from_url(REDIS_URL, decode_responses=True)

    consumer = AIOKafkaConsumer(
        "enriched-mentions",
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id="alert-engine",
        value_deserializer=lambda v: json.loads(v.decode()),
        auto_offset_reset="latest",
        **kafka_config(),
    )
    await consumer.start()
    log.info("Alert engine started")

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
                    rules = await load_rules(session)

                    for rule in rules:
                        if rule["project_id"] != project_id:
                            continue

                        trigger = rule["trigger_type"]
                        fired   = False
                        value   = 0

                        if trigger == "spike":
                            count = await check_spike(
                                redis, project_id, platform,
                                rule["threshold"], rule["window_minutes"]
                            )
                            if count:
                                fired = True
                                value = rule["threshold"]

                        elif trigger == "sentiment_drop":
                            if nlp.get("sentiment") == "negative" and nlp.get("sentiment_score", 0) > 0.85:
                                fired = True
                                value = nlp["sentiment_score"]

                        elif trigger == "keyword_hit":
                            kws = [kw.lower() for kw in nlp.get("keywords", [])]
                            if any(kw in (mention.get("content_text") or "").lower() for kw in kws):
                                fired = True
                                value = 1

                        if fired:
                            payload = {
                                "alert_name":    rule["name"],
                                "trigger_type":  trigger,
                                "project_id":    project_id,
                                "platform":      platform,
                                "current_value": value,
                                "mention":       {
                                    "id":           mention.get("id"),
                                    "text":         (mention.get("content_text") or "")[:200],
                                    "url":          mention.get("content_url"),
                                    "sentiment":    nlp.get("sentiment"),
                                    "published_at": mention.get("published_at"),
                                },
                                "fired_at": datetime.now(timezone.utc).isoformat(),
                            }
                            await dispatch_webhook(http_client, session, rule, payload)

    await consumer.stop()
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(run())
