"""
Redis Streams — drop-in replacement for Kafka in Railway deployments.
Topics map to stream keys: raw-mentions -> stream:raw-mentions
"""
import json
import asyncio
import logging
from redis.asyncio import Redis

log = logging.getLogger("streams")

STREAM_PREFIX  = "stream:"
MAX_LEN        = 50_000     # keep last 50k messages per stream
BLOCK_MS       = 2_000      # long-poll timeout


def stream_key(topic: str) -> str:
    return f"{STREAM_PREFIX}{topic}"


async def ensure_group(redis: Redis, topic: str, group: str):
    try:
        await redis.xgroup_create(stream_key(topic), group, id="$", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            log.warning("xgroup_create %s/%s: %s", topic, group, exc)


class StreamProducer:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def send(self, topic: str, value: dict, key: bytes | None = None):
        await self.redis.xadd(
            stream_key(topic),
            {"data": json.dumps(value, default=str)},
            maxlen=MAX_LEN,
            approximate=True,
        )

    async def start(self): pass
    async def stop(self): pass


class StreamConsumer:
    def __init__(self, redis: Redis, topic: str, group: str, consumer: str = "worker-1"):
        self.redis    = redis
        self.topic    = topic
        self.group    = group
        self.consumer = consumer
        self._running = True

    async def start(self):
        await ensure_group(self.redis, self.topic, self.group)

    async def stop(self):
        self._running = False

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        sk = stream_key(self.topic)
        # Drain pending (unacked from previous crash) first
        pending = await self.redis.xreadgroup(
            self.group, self.consumer, {sk: "0"}, count=100
        )
        for _, messages in (pending or []):
            for msg_id, fields in messages:
                try:
                    yield _FakeMsg(json.loads(fields["data"]), msg_id)
                    await self.redis.xack(sk, self.group, msg_id)
                except Exception as exc:
                    log.error("pending msg error: %s", exc)

        # Live stream
        while self._running:
            try:
                results = await self.redis.xreadgroup(
                    self.group, self.consumer, {sk: ">"}, count=10, block=BLOCK_MS
                )
                if not results:
                    continue
                for _, messages in results:
                    for msg_id, fields in messages:
                        try:
                            yield _FakeMsg(json.loads(fields["data"]), msg_id)
                            await self.redis.xack(sk, self.group, msg_id)
                        except Exception as exc:
                            log.error("stream msg error: %s", exc)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("xreadgroup error: %s", exc)
                await asyncio.sleep(2)


class _FakeMsg:
    """Mimics aiokafka ConsumerRecord shape so worker code needs zero changes."""
    def __init__(self, value: dict, msg_id: bytes):
        self.value = value
        self.key   = None
        self._id   = msg_id
