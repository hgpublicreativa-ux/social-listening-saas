import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Search, ExternalLink, RefreshCw, Users, TrendingUp, Heart, MessageCircle } from "lucide-react";
import MetricsCard from "../components/MetricsCard";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichedResult {
  id: string; platform: string; text: string; title: string; url: string;
  author: string; author_id: string; followers: number; published_at: string;
  likes: number; shares: number; comments: number;
  sentiment: string; sentiment_score: number; keywords: string[]; summary: string;
}

interface TopAccount {
  author: string; author_id: string; platform: string;
  followers: number; mention_count: number; sentiment: string;
}

interface SearchSummary {
  total: number; positive: number; negative: number; neutral: number;
  reach: number; engagement: number;
}

interface SearchResponse {
  query: string; summary: SearchSummary;
  top_accounts: TopAccount[]; results: EnrichedResult[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_ICON: Record<string, string> = { twitter: "𝕏", web: "📰", bluesky: "☁" };
const PLATFORM_COLOR: Record<string, string> = { twitter: "#1d9bf0", web: "#58a6ff", bluesky: "#0085ff" };

const SOURCE_LABELS = [
  { key: "twitter", label: "X / Twitter" },
  { key: "web",     label: "Google News" },
  { key: "bluesky", label: "Bluesky" },
];

const SENTIMENT_FILTER = ["", "positive", "negative", "neutral"];

// ── Fetch ─────────────────────────────────────────────────────────────────────

const doSearch = (q: string, sources: string[]): Promise<SearchResponse> =>
  api.get("/search", { params: { q, sources: sources.join(",") } }).then(r => r.data);

// ── Component ─────────────────────────────────────────────────────────────────

export default function SearchPage() {
  const [input,     setInput]     = useState("");
  const [query,     setQuery]     = useState("");
  const [sources,   setSources]   = useState(["twitter", "web", "bluesky"]);
  const [sentFilter, setSentFilter] = useState("");
  const [platFilter, setPlatFilter] = useState("");

  const { data, isFetching, isError, refetch } = useQuery<SearchResponse>({
    queryKey:  ["live-search", query, sources.join(",")],
    queryFn:   () => doSearch(query, sources),
    enabled:   !!query,
    staleTime: 120_000,
    retry:     1,
  });

  const handleSearch = () => {
    const q = input.trim();
    if (!q) return;
    setSentFilter("");
    setPlatFilter("");
    setQuery(q);
  };

  const toggleSource = (key: string) =>
    setSources(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]);

  const filtered = (data?.results ?? []).filter(r => {
    if (sentFilter && r.sentiment !== sentFilter) return false;
    if (platFilter && r.platform !== platFilter) return false;
    return true;
  });

  const s = data?.summary;
  const sentPct = s && s.total > 0 ? Math.round(s.positive / s.total * 100) : 0;
  const negPct  = s && s.total > 0 ? Math.round(s.negative / s.total * 100) : 0;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1000 }}>
      {/* Header + Search bar */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Búsqueda en Tiempo Real</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Resultados con análisis de sentimiento, alcance y engagement al instante.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              placeholder="Ej: Daniel Noboa, bitcoin, Ecuador elecciones..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              style={{ width: "100%", paddingLeft: 34, fontSize: 14, padding: "9px 14px 9px 34px" }}
              autoFocus
            />
          </div>
          <button className="btn-primary" onClick={handleSearch} disabled={!input.trim() || isFetching}
            style={{ padding: "9px 22px", fontSize: 14, whiteSpace: "nowrap" }}>
            {isFetching ? "Analizando..." : "Buscar"}
          </button>
        </div>

        {/* Source toggles */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Fuentes:</span>
          {SOURCE_LABELS.map(({ key, label }) => (
            <button key={key} onClick={() => toggleSource(key)} style={{
              background:   sources.includes(key) ? `${PLATFORM_COLOR[key]}22` : "var(--bg)",
              color:        sources.includes(key) ? PLATFORM_COLOR[key] : "var(--text-muted)",
              border:       `1px solid ${sources.includes(key) ? PLATFORM_COLOR[key] : "var(--border)"}`,
              borderRadius: 6, padding: "3px 11px", fontSize: 12, cursor: "pointer",
            }}>
              {PLATFORM_ICON[key]} {label}
            </button>
          ))}
          {data && !isFetching && (
            <button onClick={() => refetch()} style={{
              marginLeft: "auto", background: "transparent", border: "none",
              color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12,
            }}>
              <RefreshCw size={11} /> Actualizar
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isFetching && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          <p style={{ fontSize: 14 }}>Buscando y analizando con IA...</p>
          <p style={{ fontSize: 12, marginTop: 6 }}>Consultando X, Google News y Bluesky simultáneamente</p>
        </div>
      )}

      {isError && !isFetching && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#f85149" }}>
          Error al buscar. Verifica conexión y vuelve a intentar.
        </div>
      )}

      {!query && !isFetching && (
        <div style={{ textAlign: "center", padding: "64px 0", color: "var(--text-muted)" }}>
          <p style={{ fontSize: 40, marginBottom: 16 }}>🔎</p>
          <p style={{ fontSize: 15 }}>Escribe una keyword y presiona Enter</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>Análisis completo en ~5 segundos</p>
        </div>
      )}

      {/* Dashboard results */}
      {!isFetching && data && (
        <>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            <MetricsCard title="Total Menciones"  value={s!.total}      color="accent"  sub={`"${data.query}"`} />
            <MetricsCard title="Sentimiento +"    value={`${sentPct}%`} color="green"   sub={`${s!.positive} positivas`} />
            <MetricsCard title="Sentimiento −"    value={`${negPct}%`}  color="red"     sub={`${s!.negative} negativas`} />
            <MetricsCard title="Alcance Potencial" value={s!.reach.toLocaleString()} color="purple" sub="suma de seguidores" />
            <MetricsCard title="Engagement Total" value={s!.engagement.toLocaleString()} color="yellow" sub="likes+RT+comentarios" />
          </div>

          {/* Top accounts + feed */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>
            {/* Feed */}
            <div>
              {/* Filters */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{filtered.length} resultados</span>
                <select value={platFilter} onChange={e => setPlatFilter(e.target.value)} style={{ fontSize: 12, padding: "3px 8px" }}>
                  <option value="">Todas las plataformas</option>
                  <option value="twitter">X / Twitter</option>
                  <option value="web">Google News</option>
                  <option value="bluesky">Bluesky</option>
                </select>
                <select value={sentFilter} onChange={e => setSentFilter(e.target.value)} style={{ fontSize: 12, padding: "3px 8px" }}>
                  <option value="">Todo sentimiento</option>
                  <option value="positive">Positivo</option>
                  <option value="negative">Negativo</option>
                  <option value="neutral">Neutral</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.length === 0 && (
                  <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>Sin resultados para este filtro</p>
                )}
                {filtered.map((r, i) => (
                  <div key={i} className="card" style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, color: PLATFORM_COLOR[r.platform] || "var(--accent)", fontWeight: 700 }}>
                          {PLATFORM_ICON[r.platform] || "•"} {r.platform}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>· {r.author}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`badge-${r.sentiment}`}>{r.sentiment}</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                          {r.published_at ? formatDistanceToNow(parseISO(r.published_at), { addSuffix: true, locale: es }) : ""}
                        </span>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)" }}>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>

                    {r.title && r.platform === "web" && (
                      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 5 }}>{r.title}</p>
                    )}
                    <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, wordBreak: "break-word" }}>
                      {r.text.slice(0, 300)}{r.text.length > 300 ? "…" : ""}
                    </p>

                    {r.keywords?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                        {r.keywords.slice(0, 5).map((kw: string, ki: number) => (
                          <span key={ki} style={{
                            background: "rgba(88,166,255,.1)", color: "#58a6ff",
                            padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                          }}>{kw}</span>
                        ))}
                      </div>
                    )}

                    {(r.likes > 0 || r.shares > 0 || r.comments > 0) && (
                      <div style={{ display: "flex", gap: 14, marginTop: 8, color: "var(--text-muted)", fontSize: 11 }}>
                        <span>❤ {r.likes.toLocaleString()}</span>
                        <span>🔁 {r.shares.toLocaleString()}</span>
                        <span>💬 {r.comments.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Top accounts */}
              <div className="card">
                <p style={{ fontWeight: 600, marginBottom: 14, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <Users size={14} color="#bc8cff" /> Principales Cuentas
                </p>
                {data.top_accounts.length === 0 && (
                  <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Sin datos</p>
                )}
                {data.top_accounts.map((acc, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <span style={{ color: "var(--text-muted)", fontSize: 11, minWidth: 18 }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {PLATFORM_ICON[acc.platform]} {acc.author}
                      </p>
                      <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        {acc.followers > 0 ? `${acc.followers.toLocaleString()} seguidores · ` : ""}
                        {acc.mention_count} menc.
                      </p>
                    </div>
                    <span className={`badge-${acc.sentiment}`} style={{ fontSize: 9 }}>{acc.sentiment}</span>
                  </div>
                ))}
              </div>

              {/* Sentiment breakdown */}
              <div className="card">
                <p style={{ fontWeight: 600, marginBottom: 14, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <TrendingUp size={14} color="#58a6ff" /> Distribución
                </p>
                {[
                  { label: "Positivo", count: s!.positive, color: "#3fb950" },
                  { label: "Neutral",  count: s!.neutral,  color: "#8b949e" },
                  { label: "Negativo", count: s!.negative, color: "#f85149" },
                ].map(({ label, count, color }) => {
                  const pct = s!.total > 0 ? Math.round(count / s!.total * 100) : 0;
                  return (
                    <div key={label} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                        <span style={{ color }}>{label}</span>
                        <span style={{ color: "var(--text-muted)" }}>{count} ({pct}%)</span>
                      </div>
                      <div style={{ height: 6, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width .5s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
