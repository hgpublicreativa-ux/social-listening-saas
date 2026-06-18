import React, { useState } from "react";
import { useSummary, useTimeseries, useTopCreators } from "../hooks/useMetrics";
import MetricsCard from "./MetricsCard";
import SentimentChart from "./SentimentChart";
import MentionsFeed from "./MentionsFeed";
import AlertsPanel from "./AlertsPanel";
import { BarChart2, Activity, Users, Zap } from "lucide-react";

type ChartView = "mentions" | "sentiment" | "reach";

interface Props { projectId: string; projectName: string }

export default function Dashboard({ projectId, projectName }: Props) {
  const [chartView, setChartView] = useState<ChartView>("mentions");
  const { data: summary = [] }   = useSummary(projectId, 7);
  const { data: series  = [] }   = useTimeseries(projectId, 7, "hour");

  const totals = summary.reduce(
    (acc: any, row: any) => ({
      mentions:   acc.mentions   + (row.total_mentions   || 0),
      positive:   acc.positive   + (row.total_positive   || 0),
      negative:   acc.negative   + (row.total_negative   || 0),
      reach:      acc.reach      + (row.total_reach      || 0),
      engagement: acc.engagement + (row.total_engagement || 0),
    }),
    { mentions: 0, positive: 0, negative: 0, reach: 0, engagement: 0 }
  );

  const sentimentPct = totals.mentions > 0
    ? Math.round(totals.positive / totals.mentions * 100)
    : 0;

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{projectName}</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Últimos 7 días · tiempo real</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["mentions", "sentiment", "reach"] as ChartView[]).map((v) => (
            <button key={v} className={chartView === v ? "btn-primary" : "btn-ghost"} onClick={() => setChartView(v)}>
              {v === "mentions" ? "Menciones" : v === "sentiment" ? "Sentimiento" : "Alcance"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <MetricsCard title="Total Menciones"   value={totals.mentions}   color="accent"  sub="últimos 7 días" />
        <MetricsCard title="Sentimiento +"      value={`${sentimentPct}%`} color="green"   sub={`${totals.positive} positivas`} />
        <MetricsCard title="Sentimiento −"      value={`${totals.mentions > 0 ? Math.round(totals.negative / totals.mentions * 100) : 0}%`} color="red" sub={`${totals.negative} negativas`} />
        <MetricsCard title="Alcance Potencial"  value={totals.reach}      color="purple"  sub="suma de followers" />
        <MetricsCard title="Total Engagement"   value={totals.engagement} color="yellow"  sub="likes+comments+shares" />
      </div>

      {/* Chart */}
      <div className="card">
        <p style={{ fontWeight: 600, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <Activity size={15} color="#58a6ff" />
          {chartView === "mentions" ? "Volumen de Menciones" : chartView === "sentiment" ? "Distribución de Sentimiento" : "Alcance en el Tiempo"}
        </p>
        <SentimentChart data={series} view={chartView} />
      </div>

      {/* Bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 500 }}>
          <p style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart2 size={15} color="#58a6ff" /> Feed de Menciones
          </p>
          <MentionsFeed projectId={projectId} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <AlertsPanel projectId={projectId} />
          <TopCreators projectId={projectId} />
        </div>
      </div>
    </div>
  );
}

function TopCreators({ projectId }: { projectId: string }) {
  const { data = [] } = useTopCreators(projectId);
  return (
    <div className="card">
      <p style={{ fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <Users size={15} color="#bc8cff" /> Top Creadores
      </p>
      {data.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Sin datos aún</p>}
      {data.slice(0, 8).map((creator: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, minWidth: 16 }}>#{i + 1}</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 600 }}>@{creator.username || creator.display_name}</p>
            <p style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {(creator.followers || 0).toLocaleString()} seguidores · {creator.platform}
            </p>
          </div>
          <span style={{ fontSize: 11, color: "#bc8cff" }}>{creator.mention_count} menc.</span>
        </div>
      ))}
    </div>
  );
}
