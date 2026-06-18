-- Railway-compatible migration: works with standard PostgreSQL (no TimescaleDB required)
-- Idempotent: safe to re-run on every API startup WITHOUT destroying existing data.

DO $$
BEGIN
  -- Only build plain tables when TimescaleDB is NOT available.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

    -- NOTE: never DROP metrics_hourly here — run_migrations executes this file
    -- on every API boot, so a DROP would wipe all accumulated metrics each deploy.
    CREATE TABLE IF NOT EXISTS metrics_hourly (
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

    CREATE INDEX IF NOT EXISTS idx_metrics_project_bucket  ON metrics_hourly(project_id, bucket DESC);
    CREATE INDEX IF NOT EXISTS idx_metrics_platform_bucket ON metrics_hourly(platform, bucket DESC);

    -- Simple daily view (no continuous aggregate needed)
    CREATE OR REPLACE VIEW metrics_daily AS
    SELECT
        date_trunc('day', bucket) AS day,
        project_id,
        platform,
        SUM(mention_count)     AS mention_count,
        SUM(positive_count)    AS positive_count,
        SUM(negative_count)    AS negative_count,
        SUM(neutral_count)     AS neutral_count,
        SUM(total_reach)       AS total_reach,
        SUM(total_engagement)  AS total_engagement
    FROM metrics_hourly
    GROUP BY 1, 2, 3;

    RAISE NOTICE 'Created plain PostgreSQL metrics tables (no TimescaleDB)';
  ELSE
    RAISE NOTICE 'TimescaleDB detected — skipping compat migration';
  END IF;
END
$$;
