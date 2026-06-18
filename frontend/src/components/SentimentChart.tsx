import React from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";

interface Bucket {
  bucket: string;
  platform: string;
  mention_count: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  total_reach: number;
}

interface Props {
  data: Bucket[];
  view?: "mentions" | "sentiment" | "reach";
}

function aggregateByBucket(data: Bucket[]) {
  const map: Record<string, { bucket: string; mentions: number; positive: number; negative: number; neutral: number; reach: number }> = {};
  for (const row of data) {
    if (!map[row.bucket]) {
      map[row.bucket] = { bucket: row.bucket, mentions: 0, positive: 0, negative: 0, neutral: 0, reach: 0 };
    }
    map[row.bucket].mentions  += row.mention_count;
    map[row.bucket].positive  += row.positive_count;
    map[row.bucket].negative  += row.negative_count;
    map[row.bucket].neutral   += row.neutral_count;
    map[row.bucket].reach     += row.total_reach;
  }
  return Object.values(map).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "var(--text-muted)", marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <strong>{p.value?.toLocaleString()}</strong></p>
      ))}
    </div>
  );
};

export default function SentimentChart({ data, view = "mentions" }: Props) {
  const agg = aggregateByBucket(data);

  const formatted = agg.map((d) => ({
    ...d,
    label: format(parseISO(d.bucket), "MM/dd HH:mm"),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={formatted} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          {[
            ["mentions", "#58a6ff"],
            ["positive", "#3fb950"],
            ["negative", "#f85149"],
            ["neutral",  "#8b949e"],
            ["reach",    "#bc8cff"],
          ].map(([key, color]) => (
            <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
        <XAxis dataKey="label" tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} />
        <YAxis tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} axisLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11, color: "#8b949e" }} />

        {view === "mentions" && (
          <Area type="monotone" dataKey="mentions" name="Menciones" stroke="#58a6ff" fill="url(#grad-mentions)" strokeWidth={2} dot={false} />
        )}
        {view === "sentiment" && (
          <>
            <Area type="monotone" dataKey="positive" name="Positivo" stroke="#3fb950" fill="url(#grad-positive)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="negative" name="Negativo" stroke="#f85149" fill="url(#grad-negative)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="neutral"  name="Neutral"  stroke="#8b949e" fill="url(#grad-neutral)"  strokeWidth={1.5} dot={false} />
          </>
        )}
        {view === "reach" && (
          <Area type="monotone" dataKey="reach" name="Alcance" stroke="#bc8cff" fill="url(#grad-reach)" strokeWidth={2} dot={false} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
