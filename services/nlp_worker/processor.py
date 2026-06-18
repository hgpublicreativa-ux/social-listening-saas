import hashlib
import json
import logging
import os

from openai import AsyncOpenAI
from redis.asyncio import Redis

log = logging.getLogger("nlp_worker.processor")

_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

PROMPT = """\
You are a social media analyst. Analyze the following texts and return ONLY a valid JSON array.
For each item include:
- "id": the same id provided
- "sentiment": "positive" | "negative" | "neutral"
- "sentiment_score": float 0-1
- "keywords": array of up to 5 relevant keywords
- "entities": array of {{"name": str, "type": "ARTIST"|"BRAND"|"PERSON"|"PLACE"|"SONG"|"OTHER"}}
- "summary": one-sentence summary in the same language as the text

Texts:
{texts_json}

Return ONLY the JSON array, no markdown, no explanation."""


def _cache_key(text: str) -> str:
    return "nlp:cache:" + hashlib.sha256(text[:400].encode()).hexdigest()


async def _get_cached(redis: Redis, text: str) -> dict | None:
    raw = await redis.get(_cache_key(text))
    return json.loads(raw) if raw else None


async def _set_cached(redis: Redis, text: str, result: dict):
    await redis.set(_cache_key(text), json.dumps(result), ex=86400 * 14)


def _fallback(text: str) -> dict:
    words = [w.lower() for w in text.split() if len(w) > 4][:5]
    return {
        "sentiment": "neutral",
        "sentiment_score": 0.5,
        "keywords": words,
        "entities": [],
        "summary": text[:120],
        "nlp_tier": "fallback",
    }


async def llm_batch(redis: Redis, items: list[dict]) -> list[dict]:
    uncached, results = [], {}

    for item in items:
        cached = await _get_cached(redis, item["text"])
        if cached:
            results[item["id"]] = cached
        else:
            uncached.append(item)

    for i in range(0, len(uncached), 20):
        batch = uncached[i:i + 20]
        payload = [{"id": x["id"], "text": x["text"][:600]} for x in batch]

        try:
            resp = await _client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=2048,
                temperature=0,
                messages=[{
                    "role": "user",
                    "content": PROMPT.format(texts_json=json.dumps(payload, ensure_ascii=False))
                }],
            )
            parsed = json.loads(resp.choices[0].message.content)
            for r in parsed:
                rid = r.pop("id")
                results[rid] = r
                orig = next((x["text"] for x in batch if x["id"] == rid), None)
                if orig:
                    await _set_cached(redis, orig, r)
        except Exception as exc:
            log.error("GPT batch failed: %s", exc)
            for item in batch:
                results[item["id"]] = _fallback(item["text"])

    return [{"id": k, **v} for k, v in results.items()]


async def process_mention(redis: Redis, mention: dict) -> dict:
    text = mention.get("content_text") or ""
    if not text.strip():
        return _fallback(text)

    results = await llm_batch(redis, [{"id": mention["id"], "text": text}])
    result = results[0]
    result.pop("id", None)
    result["nlp_tier"] = "gpt"
    return result
