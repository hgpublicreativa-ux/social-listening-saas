import React, { useMemo } from "react";
import { Zap } from "lucide-react";

interface Props {
  results: Array<{ keywords: string[]; platform: string }>;
  onTrendingClick?: (keyword: string) => void;
  region?: "ecuador" | "all";
}

export default function TrendingWidget({ results, onTrendingClick, region = "ecuador" }: Props) {
  const trending = useMemo(() => {
    const freq: Record<string, number> = {};

    // Filter by region
    const filtered = region === "ecuador"
      ? results.filter(r => r.platform === "gnews_ec" || r.platform === "media")
      : results;

    filtered.forEach(r => {
      r.keywords?.forEach(kw => {
        freq[kw] = (freq[kw] || 0) + 1;
      });
    });

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw, count]) => ({ kw, count }));
  }, [results, region]);

  if (trending.length === 0) return null;

  const maxCount = trending[0]?.count || 1;

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <Zap size={14} color="var(--accent)" />
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
          Trending {region === "ecuador" && "🇪🇨 Ecuador"}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {trending.map(({ kw, count }, i) => {
          const pct = Math.round((count / maxCount) * 100);
          return (
            <button
              key={kw}
              onClick={() => onTrendingClick?.(kw)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                padding: 0,
                transition: "opacity .2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              {/* Rank */}
              <span style={{ fontSize: 11, fontWeight: 900, color: "var(--accent)", minWidth: 16 }}>
                {i + 1}
              </span>

              {/* Progress bar + label */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                    #{kw}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {count}
                  </span>
                </div>
                <div style={{
                  height: 4,
                  background: "var(--surface-2)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, var(--accent), var(--accent-deep))`,
                    borderRadius: 2,
                    transition: "width .3s ease",
                  }} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
