import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatDistanceToNow, parseISO, subDays, isAfter } from "date-fns";
import { es } from "date-fns/locale";
import { Search, ExternalLink, RefreshCw, Users, TrendingUp, Calendar } from "lucide-react";

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
const PICON: Record<string, string>  = { twitter: "𝕏", web: "📰", bluesky: "☁", media: "📺" };
const PCOLOR: Record<string, string> = { twitter: "#1d9bf0", web: "#58a6ff", bluesky: "#0085ff", media: "#e3a000" };
const PLABEL: Record<string, string> = { twitter: "X / Twitter", web: "Google News", bluesky: "Bluesky", media: "Medios EC" };

const SENT_COLOR: Record<string, string> = {
  positive: "#3fb950", negative: "#f85149", neutral: "#8b949e",
};
const SENT_BG: Record<string, string> = {
  positive: "rgba(63,185,80,.15)", negative: "rgba(248,81,73,.15)", neutral: "rgba(139,148,158,.12)",
};

const SOURCE_KEYS = ["twitter", "web", "bluesky", "media"] as const;

const DATE_PRESETS = [
  { label: "7d",  days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const doSearch = (q: string, sources: string[]): Promise<SearchResponse> =>
  api.get("/search", { params: { q, sources: sources.join(",") } }).then(r => r.data);

function filterByDays(results: EnrichedResult[], days: number): EnrichedResult[] {
  if (!days) return results;
  const cutoff = subDays(new Date(), days);
  return results.filter(r => {
    try { return isAfter(parseISO(r.published_at), cutoff); }
    catch { return true; }
  });
}

function SentimentBadge({ s }: { s: string }) {
  return (
    <span style={{
      background: SENT_BG[s] || SENT_BG.neutral,
      color: SENT_COLOR[s] || SENT_COLOR.neutral,
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      textTransform: "uppercase", letterSpacing: "0.5px",
    }}>{s}</span>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="card" style={{ padding: "16px 18px", minWidth: 130 }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function ResultCard({ r }: { r: EnrichedResult }) {
  return (
    <div className="card" style={{ padding: "14px 16px", borderLeft: `3px solid ${PCOLOR[r.platform] || "var(--border)"}` }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: PCOLOR[r.platform], fontWeight: 800 }}>
            {PICON[r.platform]}
          </span>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{r.author}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
              {r.followers > 0 ? `${r.followers.toLocaleString()} seguidores` : PLABEL[r.platform]}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <SentimentBadge s={r.sentiment} />
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
            {r.published_at ? formatDistanceToNow(parseISO(r.published_at), { addSuffix: true, locale: es }) : ""}
          </span>
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)", display: "flex" }}>
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>

      {/* Title for news */}
      {r.title && r.platform === "web" && r.title !== r.author && (
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: "var(--text)", lineHeight: 1.4 }}>{r.title}</p>
      )}

      {/* Text */}
      <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, wordBreak: "break-word" }}>
        {r.text.slice(0, 280)}{r.text.length > 280 ? "…" : ""}
      </p>

      {/* Keywords */}
      {r.keywords?.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
          {r.keywords.slice(0, 5).map((kw, i) => (
            <span key={i} style={{
              background: "rgba(88,166,255,.1)", color: "#58a6ff",
              padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
            }}>{kw}</span>
          ))}
        </div>
      )}

      {/* Metrics */}
      {(r.likes > 0 || r.shares > 0 || r.comments > 0) && (
        <div style={{ display: "flex", gap: 16, marginTop: 10, color: "var(--text-muted)", fontSize: 11 }}>
          {r.likes    > 0 && <span>❤ {r.likes.toLocaleString()}</span>}
          {r.shares   > 0 && <span>🔁 {r.shares.toLocaleString()}</span>}
          {r.comments > 0 && <span>💬 {r.comments.toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SearchPage() {
  const [input,      setInput]      = useState("");
  const [query,      setQuery]      = useState("");
  const [sources,    setSources]    = useState<string[]>(["twitter", "web", "bluesky", "media"]);
  const [tab,        setTab]        = useState<"all" | "twitter" | "web" | "bluesky" | "media">("all");
  const [sentFilter, setSentFilter] = useState("");
  const [dateDays,   setDateDays]   = useState(60);

  const { data, isFetching, isError, refetch } = useQuery<SearchResponse>({
    queryKey:  ["live-search", query, sources.join(",")],
    queryFn:   () => doSearch(query, sources),
    enabled:   !!query,
    staleTime: 120_000,
    retry:     1,
  });

  const go = () => {
    const q = input.trim();
    if (!q) return;
    setSentFilter("");
    setDateDays(60);
    setTab("all");
    setQuery(q);
  };

  const toggleSrc = (k: string) =>
    setSources(p => p.includes(k) ? p.filter(s => s !== k) : [...p, k]);

  const all = filterByDays(data?.results ?? [], dateDays);
  const byPlatform = {
    twitter: all.filter(r => r.platform === "twitter"),
    web:     all.filter(r => r.platform === "web"),
    bluesky: all.filter(r => r.platform === "bluesky"),
    media:   all.filter(r => r.platform === "media"),
  };

  const tabResults = tab === "all" ? all : byPlatform[tab] ?? [];
  const filtered   = sentFilter ? tabResults.filter(r => r.sentiment === sentFilter) : tabResults;

  // Recalculate summary from filtered results
  const pos = all.filter(r => r.sentiment === "positive").length;
  const neg = all.filter(r => r.sentiment === "negative").length;
  const s = data?.summary ? {
    ...data.summary,
    total:    all.length,
    positive: pos,
    negative: neg,
    neutral:  all.length - pos - neg,
    reach:      all.reduce((a, r) => a + r.followers, 0),
    engagement: all.reduce((a, r) => a + r.likes + r.shares + r.comments, 0),
  } : data?.summary;
  const sentPct = s && s.total > 0 ? Math.round(s.positive / s.total * 100) : 0;
  const negPct  = s && s.total > 0 ? Math.round(s.negative / s.total * 100) : 0;

  return (
    <div className="page-pad">
      {/* Search bar */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Búsqueda en Tiempo Real</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Sentimiento, alcance y engagement al instante desde múltiples fuentes.
        </p>

        <div className="search-bar-row" style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              placeholder='Ej: "Daniel Noboa", bitcoin, Ecuador elecciones...'
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && go()}
              style={{ width: "100%", paddingLeft: 36, fontSize: 14, padding: "10px 14px 10px 36px" }}
              autoFocus
            />
          </div>
          <button className="btn-primary" onClick={go} disabled={!input.trim() || isFetching}
            style={{ padding: "10px 24px", fontSize: 14, whiteSpace: "nowrap" }}>
            {isFetching ? "Analizando..." : "Buscar"}
          </button>
        </div>

        {/* Source chips + date filters row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Fuentes:</span>
          {SOURCE_KEYS.map(k => (
            <button key={k} onClick={() => toggleSrc(k)} style={{
              background:   sources.includes(k) ? `${PCOLOR[k]}20` : "transparent",
              color:        sources.includes(k) ? PCOLOR[k] : "var(--text-muted)",
              border:       `1px solid ${sources.includes(k) ? PCOLOR[k] : "var(--border)"}`,
              borderRadius: 20, padding: "3px 12px", fontSize: 12, cursor: "pointer",
            }}>
              {PICON[k]} {PLABEL[k]}
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

        {/* Date range presets */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <Calendar size={13} color="var(--text-muted)" />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Período:</span>
          {DATE_PRESETS.map(({ label, days }) => (
            <button key={days} onClick={() => setDateDays(days)}
              disabled={!data}
              className={dateDays === days ? "btn-primary" : "btn-ghost"}
              style={{ padding: "3px 10px", fontSize: 12, opacity: !data ? 0.4 : 1 }}>
              {label}
            </button>
          ))}
          {data && dateDays > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
              · {all.length} resultado{all.length !== 1 ? "s" : ""} en los últimos {dateDays} días
            </span>
          )}
        </div>
      </div>

      {/* Loading */}
      {isFetching && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🔍</div>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Buscando y analizando con IA...</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>Consultando X, Google News y Bluesky en paralelo</p>
        </div>
      )}

      {isError && !isFetching && (
        <div className="card" style={{ textAlign: "center", padding: 32, color: "#f85149" }}>
          Error al conectar con el servidor. Intenta de nuevo.
        </div>
      )}

      {!query && !isFetching && (
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>🔎</p>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Escribe cualquier keyword</p>
          <p style={{ fontSize: 13 }}>Análisis completo con IA en ~5 segundos</p>
        </div>
      )}

      {/* Results dashboard */}
      {!isFetching && data && (
        <>
          {/* KPI row */}
          <div className="kpi-grid" style={{ marginBottom: 24 }}>
            <KpiCard label="Menciones"    value={s!.total}      color="var(--accent)"  sub={`"${data.query}"`} />
            <KpiCard label="Positivo"     value={`${sentPct}%`} color="#3fb950"        sub={`${s!.positive} positivas`} />
            <KpiCard label="Negativo"     value={`${negPct}%`}  color="#f85149"        sub={`${s!.negative} negativas`} />
            <KpiCard label="Alcance"      value={s!.reach}      color="#bc8cff"        sub="suma seguidores" />
            <KpiCard label="Engagement"   value={s!.engagement} color="#e3b341"        sub="likes+RT+comentarios" />
          </div>

          {/* Main content: feed + sidebar */}
          <div className="search-grid">

            {/* Feed */}
            <div>
              {/* Platform tabs */}
              <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
                {[
                  { key: "all",     label: `Todos (${all.length})` },
                  { key: "twitter", label: `𝕏 Twitter (${byPlatform.twitter.length})` },
                  { key: "web",     label: `📰 Noticias (${byPlatform.web.length})` },
                  { key: "bluesky", label: `☁ Bluesky (${byPlatform.bluesky.length})` },
                  { key: "media",   label: `📺 Medios EC (${byPlatform.media.length})` },
                ].map(({ key, label }) => (
                  <button key={key} onClick={() => setTab(key as any)} style={{
                    background:   "transparent",
                    color:        tab === key ? "var(--text)" : "var(--text-muted)",
                    border:       "none",
                    borderBottom: `2px solid ${tab === key ? "#58a6ff" : "transparent"}`,
                    padding:      "8px 14px",
                    fontSize:     13,
                    fontWeight:   tab === key ? 700 : 400,
                    cursor:       "pointer",
                    marginBottom: -1,
                  }}>{label}</button>
                ))}

                {/* Sentiment filter */}
                <select
                  value={sentFilter}
                  onChange={e => setSentFilter(e.target.value)}
                  style={{ marginLeft: "auto", fontSize: 12, padding: "4px 8px", alignSelf: "center" }}
                >
                  <option value="">Todo sentimiento</option>
                  <option value="positive">✅ Positivo</option>
                  <option value="negative">❌ Negativo</option>
                  <option value="neutral">⬜ Neutral</option>
                </select>
              </div>

              {filtered.length === 0 && (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "40px 0", fontSize: 14 }}>
                  Sin resultados para este filtro
                </p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.map((r, i) => <ResultCard key={i} r={r} />)}
              </div>
            </div>

            {/* Sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Sentiment bars */}
              <div className="card">
                <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                  <TrendingUp size={14} color="#58a6ff" /> Distribución
                </p>
                {[
                  { label: "Positivo", count: s!.positive, color: "#3fb950" },
                  { label: "Neutral",  count: s!.neutral,  color: "#8b949e" },
                  { label: "Negativo", count: s!.negative, color: "#f85149" },
                ].map(({ label, count, color }) => {
                  const pct = s!.total > 0 ? Math.round(count / s!.total * 100) : 0;
                  return (
                    <div key={label} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                        <span style={{ color, fontWeight: 600 }}>{label}</span>
                        <span style={{ color: "var(--text-muted)" }}>{count} · {pct}%</span>
                      </div>
                      <div style={{ height: 7, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width .6s ease" }} />
                      </div>
                    </div>
                  );
                })}

                {/* Por plataforma */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 4 }}>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 10 }}>Por Plataforma</p>
                  {SOURCE_KEYS.filter(k => byPlatform[k].length > 0).map(k => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8, alignItems: "center" }}>
                      <span style={{ color: PCOLOR[k] }}>{PICON[k]} {PLABEL[k]}</span>
                      <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{byPlatform[k].length}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top accounts */}
              {data.top_accounts.length > 0 && (
                <div className="card">
                  <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <Users size={14} color="#bc8cff" /> Principales Cuentas
                  </p>
                  {data.top_accounts.slice(0, 8).map((acc, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ color: "var(--text-muted)", fontSize: 11, minWidth: 18, fontWeight: 600 }}>#{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: PCOLOR[acc.platform] }}>{PICON[acc.platform]}</span> {acc.author}
                        </p>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                          {acc.followers > 0 ? `${acc.followers.toLocaleString()} seg · ` : ""}
                          {acc.mention_count} menc.
                        </p>
                      </div>
                      <SentimentBadge s={acc.sentiment} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
