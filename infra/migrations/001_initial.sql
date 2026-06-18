-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ── Organizations & Users ────────────────────────────────────────────────
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'free',
    api_key     TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email           TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Projects (monitoring campaigns) ─────────────────────────────────────
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    keywords        TEXT[] NOT NULL DEFAULT '{}',
    sources         TEXT[] NOT NULL DEFAULT '{twitter,youtube}',
    language        CHAR(2) DEFAULT 'es',
    active          BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Social Profiles ──────────────────────────────────────────────────────
CREATE TABLE social_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform        TEXT NOT NULL,
    platform_id     TEXT NOT NULL,
    username        TEXT,
    display_name    TEXT,
    followers       BIGINT DEFAULT 0,
    following       BIGINT DEFAULT 0,
    verified        BOOLEAN DEFAULT false,
    avatar_url      TEXT,
    meta            JSONB DEFAULT '{}',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(platform, platform_id)
);

-- ── Mentions (core entity) ───────────────────────────────────────────────
CREATE TABLE mentions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
    profile_id          UUID REFERENCES social_profiles(id),
    platform            TEXT NOT NULL,
    platform_post_id    TEXT NOT NULL,
    content_text        TEXT,
    content_url         TEXT,
    media_urls          TEXT[] DEFAULT '{}',
    language            CHAR(2),
    published_at        TIMESTAMPTZ NOT NULL,
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NLP enrichment
    sentiment           TEXT,
    sentiment_score     NUMERIC(4,3),
    keywords            TEXT[] DEFAULT '{}',
    entities            JSONB DEFAULT '[]',
    summary             TEXT,
    nlp_tier            TEXT DEFAULT 'pending',
    -- raw metrics at ingest
    likes               BIGINT DEFAULT 0,
    shares              BIGINT DEFAULT 0,
    comments            BIGINT DEFAULT 0,
    views               BIGINT DEFAULT 0,
    UNIQUE(platform, platform_post_id)
);

CREATE INDEX idx_mentions_project_published ON mentions(project_id, published_at DESC);
CREATE INDEX idx_mentions_sentiment ON mentions(project_id, sentiment);
CREATE INDEX idx_mentions_platform ON mentions(platform, published_at DESC);
CREATE INDEX idx_mentions_entities ON mentions USING GIN(entities);
CREATE INDEX idx_mentions_keywords ON mentions USING GIN(keywords);

-- ── Time-series metrics (hypertable) ────────────────────────────────────
CREATE TABLE metrics_hourly (
    bucket              TIMESTAMPTZ NOT NULL,
    project_id          UUID NOT NULL,
    platform            TEXT NOT NULL,
    mention_count       INT DEFAULT 0,
    positive_count      INT DEFAULT 0,
    negative_count      INT DEFAULT 0,
    neutral_count       INT DEFAULT 0,
    total_reach         BIGINT DEFAULT 0,
    total_engagement    BIGINT DEFAULT 0,
    avg_sentiment_score NUMERIC(4,3),
    PRIMARY KEY (bucket, project_id, platform)
);

SELECT create_hypertable('metrics_hourly', 'bucket');

CREATE INDEX idx_metrics_project ON metrics_hourly(project_id, bucket DESC);

-- Continuous aggregate: daily rollup
CREATE MATERIALIZED VIEW metrics_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', bucket) AS day,
    project_id,
    platform,
    SUM(mention_count)       AS mention_count,
    SUM(positive_count)      AS positive_count,
    SUM(negative_count)      AS negative_count,
    SUM(neutral_count)       AS neutral_count,
    SUM(total_reach)         AS total_reach,
    SUM(total_engagement)    AS total_engagement
FROM metrics_hourly
GROUP BY 1, 2, 3
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_daily',
    start_offset  => INTERVAL '3 days',
    end_offset    => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- ── Creator Rankings ─────────────────────────────────────────────────────
CREATE TABLE creator_rankings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    profile_id      UUID REFERENCES social_profiles(id),
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    mention_count   INT DEFAULT 0,
    total_reach     BIGINT DEFAULT 0,
    engagement_rate NUMERIC(6,4),
    influence_score NUMERIC(8,2),
    rank            INT,
    UNIQUE(project_id, profile_id, period_start)
);

-- ── Alert Rules ──────────────────────────────────────────────────────────
CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    trigger_type    TEXT NOT NULL,
    threshold       NUMERIC,
    window_minutes  INT DEFAULT 60,
    webhook_url     TEXT,
    webhook_secret  TEXT,
    active          BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id         UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_value   NUMERIC,
    payload         JSONB DEFAULT '{}',
    delivered       BOOLEAN DEFAULT false,
    delivered_at    TIMESTAMPTZ,
    error           TEXT
);

-- Seed demo org
INSERT INTO organizations(name, plan) VALUES ('Demo Org', 'pro') RETURNING id;
