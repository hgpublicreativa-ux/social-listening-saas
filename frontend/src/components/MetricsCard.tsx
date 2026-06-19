import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  title: string;
  value: string | number;
  delta?: number;
  sub?: string;
  color?: "accent" | "green" | "red" | "purple" | "yellow";
}

const colorMap: Record<string, string> = {
  accent: "var(--accent)",
  green:  "var(--green)",
  red:    "var(--red)",
  purple: "var(--violet)",
  yellow: "var(--teal)",
};

export default function MetricsCard({ title, value, delta, sub, color = "accent" }: Props) {
  const accent = colorMap[color] || colorMap.accent;
  return (
    <div className="card" style={{ padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      {/* colored accent strip */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />
      <p style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        {title}
      </p>
      <p style={{ fontSize: 28, fontWeight: 900, color: accent, lineHeight: 1 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {(delta !== undefined || sub) && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 12 }}>
          {delta !== undefined && (
            delta > 0
              ? <TrendingUp size={13} color="var(--green)" />
              : delta < 0
              ? <TrendingDown size={13} color="var(--red)" />
              : <Minus size={13} />
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}
