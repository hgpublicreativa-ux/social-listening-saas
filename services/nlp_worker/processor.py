import hashlib
import json
import logging
import os
from functools import lru_cache

import anthropic
from redis.asyncio import Redis
from transformers import pipeline

log = logging.getLogger("nlp_worker.processor")

# ── Local models (loaded once per worker process) ────────────────────────
@lru_cache(maxsize=1)
def _sentiment_pipe():
    log.info("Loading sentiment model...")
    return pipeline(
        "text-classification",
        model="cardiffnlp/twitter-xlm-roberta-base-sentiment",
        device=-1,
    )

@lru_cache(maxsize=1)
def _ner_pipe():
    log.info("Loading NER model...")
    return pipeline(
        "ner",
        model="dslim/bert-base-NER",
        aggregation_strategy="simple",
        device=-1,
    )


# ── Tier 1: Local inference (free, ~5ms) ────────────────────────────────
def local_analyze(text: str) -> dict:
    clean = text[:512]
    try:
        sent   = _sentiment_pipe()(clean)[0]
        ents   = _ner_pipe()(clean)
        return {
            "sentiment":       sent["label"].lower(),
            "sentiment_score": round(sent["score"], 3),
            "entities": [
                {
                    "name":  e["word"],
                    "type":  e["entity_group"],
                    "score": round(e["score"], 3),
                }
                for e in ents if e["score"] > 0.85
            ],
            "keywords": [],
            "summary":  None,
        }
    except Exception as exc:
        log.warning("Local NLP failed: %s", exc)
        return {"sentiment": "neutral", "sentiment_score": 0.5, "entities": [], "keywords": [], "summary": None}


# ── Tier 2: Redis semantic cache ─────────────────────────────────────────
def _cache_key(text: str) -> str:
    return "nlp:cache:" + hashlib.sha256(text[:400].encode()).hexdigest()

async def get_cached(redis: Redis, text: str) -> dict | None:
    raw = await redis.get(_cache_key(text))
    return json.loads(raw) if raw else None

async def set_cached(redis: Redis, text: str, result: dict):
    await redis.set(_cache_key(text), json.dumps(result), ex=86400 * 14)


# ── Tier 3: LLM batch (Claude Haiku) ────────────────────────────────────
_client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

BATCH_PROMPT = """\
You are a social media analyst. Analyze the following texts and return ONLY a valid JSON array.
For each item, include:
- "id": the same id provided
- "sentiment": "positive" | "negative" | "neutral"
- "sentiment_score": float 0-1
- "keywords": array of 5 most relevant keywords
- "entities": array of [{{"name": str, "type": "ARTIST"|"BRAND"|"PERSON"|"PLACE"|"SONG"|"OTHER"}}]
- "summary": one-sentence summary in the same language as the text

Texts:
{texts_json}

Return ONLY the JSON array, no markdown, no explanation."""


async def llm_batch_analyze(redis: Redis, items: list[dict]) -> list[dict]:
    uncached, results = [], {}

    for item in items:
        cached = await get_cached(redis, item["text"])
        if cached:
            results[item["id"]] = cached
        else:
            uncached.append(item)

    if not uncached:
        return [{"id": k, **v} for k, v in results.items()]

    for i in range(0, len(uncached), 20):
        batch = uncached[i:i+20]
        payload = [{"id": x["id"], "text": x["text"][:600]} for x in batch]

        try:
            resp = await _client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                messages=[{
                    "role": "user",
                    "content": BATCH_PROMPT.format(texts_json=json.dumps(payload, ensure_ascii=False))
                }],
            )
            parsed = json.loads(resp.content[0].text)
            for item_result in parsed:
                rid = item_result.pop("id")
                results[rid] = item_result
                orig_text = next((x["text"] for x in batch if x["id"] == rid), None)
                if orig_text:
                    await set_cached(redis, orig_text, item_result)

        except Exception as exc:
            log.error("LLM batch failed: %s", exc)
            for item in batch:
                results[item["id"]] = local_analyze(item["text"])

    return [{"id": k, **v} for k, v in results.items()]


# ── Router: decide tier ──────────────────────────────────────────────────
async def process_mention(redis: Redis, mention: dict) -> dict:
    text      = mention.get("content_text") or ""
    followers = mention.get("author", {}).get("followers", 0)
    is_spike  = mention.get("is_viral_spike", False)

    local_result = local_analyze(text)

    needs_llm = (
        followers > 50_000
        or is_spike
        or local_result["sentiment_score"] < 0.72
        or not local_result["entities"]
    )

    if needs_llm:
        llm_results = await llm_batch_analyze(redis, [{"id": mention["id"], "text": text}])
        merged = {**local_result, **llm_results[0]}
        merged.pop("id", None)
        merged["nlp_tier"] = "llm"
        return merged

    local_result["nlp_tier"] = "local"
    return local_result
