-- Railway-compatible migration: works with standard PostgreSQL (no TimescaleDB required)
-- Run AFTER 001_initial.sql only if TimescaleDB is NOT available

DO $$
BEGIN
  -- Check if TimescaleDB is installed; if not, create metrics_hourly as plain table
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

    -- Drop hypertable if partially created
    DROP TABLE IF EXISTS metrics_hourly CASCADE;
    DROP MATERIALIZED VIEW IF EXISTS metrics_daily;

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

    CREATE INDEX idx_metrics_project_bucket ON metrics_hourly(project_id, bucket DESC);
    CREATE INDEX idx_metrics_platform_bucket ON metrics_hourly(platform, bucket DESC);

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
