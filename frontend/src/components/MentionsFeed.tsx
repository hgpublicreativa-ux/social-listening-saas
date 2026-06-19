import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMentions } from "../api/client";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Search, ExternalLink } from "lucide-react";

const PLATFORMS = ["", "twitter", "youtube", "tiktok", "facebook", "web", "bluesky"];
const SENTIMENTS = ["", "positive", "negative", "neutral"];

const platformIcon: Record<string, string> = {
  twitter:  "𝕏",
  youtube:  "▶",
  tiktok:   "♪",
  facebook: "f",
  web:      "🌐",
  bluesky:  "☁",
};

interface Props { projectId: string }

export default function MentionsFeed({ projectId }: Props) {
  const [platform,  setPlatform]  = useState("");
  const [sentiment, setSentiment] = useState("");
  const [q,         setQ]         = useState("");
  const [search,    setSearch]    = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["mentions", projectId, platform, sentiment, search],
    queryFn:  () => getMentions(projectId, { platform: platform || undefined, sentiment: sentiment || undefined, q: search || undefined, limit: 50 }),
    enabled:  !!projectId,
  });

  return (
    <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input
            placeholder="Buscar menciones..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearch(q)}
            style={{ width: "100%", paddingLeft: 28 }}
          />
        </div>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p || "Todas las plataformas"}</option>)}
        </select>
        <select value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
          {SENTIMENTS.map((s) => <option key={s} value={s}>{s || "Todo sentimiento"}</option>)}
        </select>
      </div>

      <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        {isLoading && <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>Cargando menciones...</p>}
        {!isLoading && data.length === 0 && (
          <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 24 }}>Sin menciones para este filtro</p>
        )}
        {data.map((m: any) => (
          <div key={m.id} style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={`platform-${m.platform}`} style={{ fontSize: 12, fontWeight: 700 }}>
                {platformIcon[m.platform] || m.platform} {m.platform}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {m.sentiment && <span className={`badge-${m.sentiment}`}>{m.sentiment}</span>}
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  {m.published_at ? formatDistanceToNow(parseISO(m.published_at), { addSuffix: true, locale: es }) : ""}
                </span>
                {m.content_url && (
                  <a href={m.content_url} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)" }}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
            <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, wordBreak: "break-word" }}>
              {(m.content_text || "").slice(0, 280)}
              {m.content_text?.length > 280 ? "…" : ""}
            </p>
            {m.keywords?.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {m.keywords.slice(0, 5).map((kw: string) => (
                  <span key={kw} style={{
                    background: "var(--accent-soft)", color: "var(--accent)",
                    padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 700
                  }}>{kw}</span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 14, color: "var(--text-muted)", fontSize: 11 }}>
              <span>❤ {(m.likes || 0).toLocaleString()}</span>
              <span>💬 {(m.comments || 0).toLocaleString()}</span>
              <span>🔁 {(m.shares || 0).toLocaleString()}</span>
              <span>👁 {(m.views || 0).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
