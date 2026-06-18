import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import clsx from "clsx";

interface Props {
  title: string;
  value: string | number;
  delta?: number;
  sub?: string;
  color?: "accent" | "green" | "red" | "purple" | "yellow";
}

const colorMap: Record<string, string> = {
  accent: "#58a6ff",
  green:  "#3fb950",
  red:    "#f85149",
  purple: "#bc8cff",
  yellow: "#d29922",
};

export default function MetricsCard({ title, value, delta, sub, color = "accent" }: Props) {
  const accent = colorMap[color];
  return (
    <div className="card" style={{ borderTop: `2px solid ${accent}` }}>
      <p style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: 8 }}>
        {title}
      </p>
      <p style={{ fontSize: 28, fontWeight: 700, color: accent, lineHeight: 1 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {(delta !== undefined || sub) && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 12 }}>
          {delta !== undefined && (
            delta > 0
              ? <TrendingUp size={13} color="#3fb950" />
              : delta < 0
              ? <TrendingDown size={13} color="#f85149" />
              : <Minus size={13} />
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}
