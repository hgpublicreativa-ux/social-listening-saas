"""Lightweight NLP batch processor for on-demand search enrichment."""
import hashlib
import json
import logging
import os

from openai import AsyncOpenAI
from redis.asyncio import Redis

log = logging.getLogger("api.nlp")

_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

PROMPT = """\
You are a social media analyst. Analyze the following texts and return ONLY a valid JSON array.
For each item include:
- "id": the same id provided
- "sentiment": "positive" | "negative" | "neutral"
- "sentiment_score": float 0-1
- "keywords": array of up to 5 relevant keywords
- "entities": array of {{"name": str, "type": "PERSON"|"BRAND"|"PLACE"|"EVENT"|"OTHER"}}
- "summary": one-sentence summary in the same language as the text

Texts:
{texts_json}

Return ONLY the JSON array, no markdown, no explanation."""


def _cache_key(text: str) -> str:
    return "nlp:cache:" + hashlib.sha256(text[:400].encode()).hexdigest()


def _fallback(item_id: str, text: str) -> dict:
    return {
        "id": item_id,
        "sentiment": "neutral",
        "sentiment_score": 0.5,
        "keywords": [],
        "entities": [],
        "summary": text[:120],
        "nlp_tier": "fallback",
    }


async def enrich_batch(redis: Redis, items: list[dict]) -> dict[str, dict]:
    """
    items: list of {"id": str, "text": str}
    returns: dict mapping id -> nlp result
    """
    results: dict[str, dict] = {}
    uncached: list[dict] = []

    for item in items:
        key = _cache_key(item["text"])
        raw = await redis.get(key)
        if raw:
            results[item["id"]] = json.loads(raw)
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
                messages=[{"role": "user", "content": PROMPT.format(
                    texts_json=json.dumps(payload, ensure_ascii=False)
                )}],
            )
            parsed = json.loads(resp.choices[0].message.content)
            for r in parsed:
                rid = r.get("id")
                if not rid:
                    continue
                data = {k: v for k, v in r.items() if k != "id"}
                data["nlp_tier"] = "gpt"
                results[rid] = data
                orig = next((x["text"] for x in batch if x["id"] == rid), None)
                if orig:
                    await redis.set(_cache_key(orig), json.dumps(data), ex=86400 * 7)
        except Exception as exc:
            log.error("GPT batch failed: %s", exc)
            for item in batch:
                results[item["id"]] = _fallback(item["id"], item["text"])

    # Fallback for any missing
    for item in items:
        if item["id"] not in results:
            results[item["id"]] = _fallback(item["id"], item["text"])

    return results
