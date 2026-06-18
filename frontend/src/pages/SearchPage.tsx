import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatDistanceToNow, parseISO, subDays, isAfter } from "date-fns";
import { es } from "date-fns/locale";
import { Search, ExternalLink, RefreshCw, Users, TrendingUp, Calendar, MessageCircle, Heart, Repeat2, Eye, Zap, Globe, BarChart2 } from "lucide-react";

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
const PICON: Record<string, string>  = { twitter: "𝕏", web: "📰", reddit: "🟠", media: "📺", gnews_ec: "🇪🇨" };
const PCOLOR: Record<string, string> = { twitter: "#1d9bf0", web: "#58a6ff", reddit: "#ff4500", media: "#e3a000", gnews_ec: "#34a853" };
const PLABEL: Record<string, string> = { twitter: "X / Twitter", web: "Google News", reddit: "Reddit", media: "Medios EC", gnews_ec: "Google News EC" };

const SENT_COLOR: Record<string, string> = { positive: "#3fb950", negative: "#f85149", neutral: "#8b949e" };
const SENT_BG: Record<string, string>    = { positive: "rgba(63,185,80,.15)", negative: "rgba(248,81,73,.15)", neutral: "rgba(139,148,158,.12)" };
const SENT_LABEL: Record<string, string> = { positive: "Positivo", negative: "Negativo", neutral: "Neutral" };
const SENT_EMOJI: Record<string, string> = { positive: "😊", negative: "😠", neutral: "😐" };

const SOURCE_KEYS = ["twitter", "web", "gnews_ec", "reddit", "media"] as const;
const DATE_PRESETS = [{ label: "7d", days: 7 }, { label: "14d", days: 14 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }];

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

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// GPT sometimes emits useless meta-summaries when the RSS has no real body
// ("The text contains a link to a news article", "no content provided", etc.)
const JUNK_SUMMARY = /contains? a link|news article|no (content|text|information|body|summary)|link to (a|an|the)|the (text|article|content) (contains|provides|is|mentions|only)|placeholder|unable to (summarize|provide)/i;

function cleanSummary(s: string): string {
  const t = (s || "").trim();
  if (!t || JUNK_SUMMARY.test(t)) return "";
  return t;
}

// Strip HTML tags, decode common entities, collapse whitespace
function stripHtml(s: string): string {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Donut Chart (pure CSS conic-gradient) ─────────────────────────────────────
function DonutChart({ pos, neg, neu, total }: { pos: number; neg: number; neu: number; total: number }) {
  if (total === 0) {
    return (
      <div style={{ width: 110, height: 110, borderRadius: "50%", background: "var(--border)", margin: "0 auto" }} />
    );
  }
  const pPct = Math.round(pos / total * 100);
  const nPct = Math.round(neg / total * 100);
  const uPct = 100 - pPct - nPct;
  const gradient = `conic-gradient(
    #3fb950 0% ${pPct}%,
    #f85149 ${pPct}% ${pPct + nPct}%,
    #8b949e ${pPct + nPct}% 100%
  )`;
  return (
    <div style={{ position: "relative", width: 110, height: 110, margin: "0 auto" }}>
      <div style={{ width: 110, height: 110, borderRadius: "50%", background: gradient }} />
      {/* hole */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        width: 62, height: 62, borderRadius: "50%",
        background: "var(--card)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", lineHeight: 1 }}>{pPct}%</span>
        <span style={{ fontSize: 9, color: "#3fb950", fontWeight: 700, textTransform: "uppercase" }}>pos</span>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color, trend }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string; trend?: string;
}) {
  return (
    <div className="card" style={{ padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      {/* colored accent strip */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "8px 8px 0 0" }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${color}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color,
        }}>{icon}</div>
        {trend && <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}15`, padding: "2px 7px", borderRadius: 20 }}>{trend}</span>}
      </div>
      <p style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, marginBottom: 4 }}>
        {typeof value === "number" ? fmt(value) : value}
      </p>
      <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      {sub && <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

// ── Sentiment Badge ───────────────────────────────────────────────────────────
function SentimentBadge({ s }: { s: string }) {
  return (
    <span style={{
      background: SENT_BG[s] || SENT_BG.neutral,
      color: SENT_COLOR[s] || SENT_COLOR.neutral,
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
    }}>{SENT_EMOJI[s]} {SENT_LABEL[s] || s}</span>
  );
}

// ── Result Card ───────────────────────────────────────────────────────────────
function ResultCard({ r }: { r: EnrichedResult }) {
  const scoreBar = Math.round((r.sentiment_score ?? 0.5) * 100);
  const isNews   = ["web", "gnews_ec", "media"].includes(r.platform);
  const summary   = cleanSummary(r.summary);
  const bodyText  = stripHtml(r.text);
  // News RSS text is always the headline/source repeated — show only the clean
  // GPT summary for news. Fallback body text is for Twitter/Reddit posts only.
  const showBody  = !summary && !isNews && bodyText.length > 20;
  return (
    <div className="card" style={{
      padding: "16px 18px",
      borderLeft: `3px solid ${PCOLOR[r.platform] || "var(--border)"}`,
      transition: "box-shadow .15s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Platform pill */}
          <span style={{
            background: `${PCOLOR[r.platform]}18`,
            color: PCOLOR[r.platform],
            fontSize: 12, fontWeight: 800,
            padding: "3px 10px", borderRadius: 20,
            border: `1px solid ${PCOLOR[r.platform]}40`,
          }}>{PICON[r.platform]} {PLABEL[r.platform]}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{r.author}</span>
          {r.followers > 0 && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              <Users size={9} style={{ display: "inline", verticalAlign: "middle" }} /> {fmt(r.followers)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <SentimentBadge s={r.sentiment} />
          <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
            {r.published_at ? formatDistanceToNow(parseISO(r.published_at), { addSuffix: true, locale: es }) : ""}
          </span>
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)", display: "flex" }}>
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {/* Title */}
      {r.title && ["web", "gnews_ec", "media"].includes(r.platform) && r.title !== r.author && (
        <p style={{ fontWeight: 800, fontSize: 15, marginBottom: 8, color: "var(--text)", lineHeight: 1.4 }}>{r.title}</p>
      )}

      {/* Summary (GPT, cleaned) or fallback body text */}
      {summary ? (
        <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7, marginBottom: 8, fontStyle: "italic", borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
          {summary}
        </p>
      ) : showBody ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, wordBreak: "break-word", marginBottom: 8 }}>
          {bodyText.slice(0, 280)}{bodyText.length > 280 ? "…" : ""}
        </p>
      ) : null}

      {/* Sentiment score bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: r.keywords?.length ? 10 : 0 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", minWidth: 70, fontWeight: 600 }}>Confianza IA</span>
        <div style={{ flex: 1, height: 4, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${scoreBar}%`, background: SENT_COLOR[r.sentiment] || "#8b949e", borderRadius: 4, transition: "width .5s" }} />
        </div>
        <span style={{ fontSize: 10, color: "var(--text-muted)", minWidth: 28, textAlign: "right" }}>{scoreBar}%</span>
      </div>

      {/* Keywords */}
      {r.keywords?.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: r.likes || r.shares || r.comments ? 10 : 0 }}>
          {r.keywords.slice(0, 5).map((kw, i) => (
            <span key={i} style={{
              background: "rgba(88,166,255,.1)", color: "#58a6ff",
              padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
            }}>#{kw}</span>
          ))}
        </div>
      )}

      {/* Metrics */}
      {(r.likes > 0 || r.shares > 0 || r.comments > 0) && (
        <div style={{ display: "flex", gap: 16, color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
          {r.likes    > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Heart size={11} /> {fmt(r.likes)}</span>}
          {r.shares   > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Repeat2 size={11} /> {fmt(r.shares)}</span>}
          {r.comments > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MessageCircle size={11} /> {fmt(r.comments)}</span>}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SearchPage() {
  const [input,      setInput]      = useState("");
  const [query,      setQuery]      = useState("");
  const [sources,    setSources]    = useState<string[]>(["gnews_ec", "media"]);
  const [tab,        setTab]        = useState<"all" | "twitter" | "web" | "gnews_ec" | "reddit" | "media">("all");
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
    twitter:  all.filter(r => r.platform === "twitter"),
    web:      all.filter(r => r.platform === "web"),
    gnews_ec: all.filter(r => r.platform === "gnews_ec"),
    reddit:   all.filter(r => r.platform === "reddit"),
    media:    all.filter(r => r.platform === "media"),
  };

  const tabResults = tab === "all" ? all : byPlatform[tab] ?? [];
  const filtered   = sentFilter ? tabResults.filter(r => r.sentiment === sentFilter) : tabResults;

  const pos = all.filter(r => r.sentiment === "positive").length;
  const neg = all.filter(r => r.sentiment === "negative").length;
  const neu = all.length - pos - neg;
  const s = data?.summary ? {
    ...data.summary,
    total: all.length, positive: pos, negative: neg, neutral: neu,
    reach:      all.reduce((a, r) => a + r.followers, 0),
    engagement: all.reduce((a, r) => a + r.likes + r.shares + r.comments, 0),
  } : data?.summary;

  const sentPct = s && s.total > 0 ? Math.round(s.positive / s.total * 100) : 0;
  const negPct  = s && s.total > 0 ? Math.round(s.negative / s.total * 100) : 0;

  return (
    <div className="page-pad">

      {/* ── Search Bar ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Búsqueda en Tiempo Real</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Sentimiento, alcance y engagement al instante desde múltiples fuentes.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              placeholder='"Daniel Noboa", bitcoin, Ecuador elecciones...'
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && go()}
              style={{ width: "100%", paddingLeft: 36, fontSize: 14, padding: "11px 14px 11px 36px" }}
              autoFocus
            />
          </div>
          <button className="btn-primary" onClick={go} disabled={!input.trim() || isFetching}
            style={{ padding: "11px 28px", fontSize: 14, whiteSpace: "nowrap", fontWeight: 700 }}>
            {isFetching ? "Analizando…" : "🔍 Buscar"}
          </button>
        </div>

        {/* Sources + refresh */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Fuentes:</span>
          {SOURCE_KEYS.map(k => (
            <button key={k} onClick={() => toggleSrc(k)} style={{
              background:   sources.includes(k) ? `${PCOLOR[k]}20` : "transparent",
              color:        sources.includes(k) ? PCOLOR[k] : "var(--text-muted)",
              border:       `1px solid ${sources.includes(k) ? PCOLOR[k] : "var(--border)"}`,
              borderRadius: 20, padding: "4px 14px", fontSize: 12, cursor: "pointer",
              fontWeight:   sources.includes(k) ? 700 : 400,
              transition:   "all .15s",
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

        {/* Date presets */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Calendar size={13} color="var(--text-muted)" />
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Período:</span>
          {DATE_PRESETS.map(({ label, days }) => (
            <button key={days} onClick={() => setDateDays(days)}
              disabled={!data}
              className={dateDays === days ? "btn-primary" : "btn-ghost"}
              style={{ padding: "3px 12px", fontSize: 12, opacity: !data ? 0.4 : 1, fontWeight: 600 }}>
              {label}
            </button>
          ))}
          {data && dateDays > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
              · <strong style={{ color: "var(--text)" }}>{all.length}</strong> resultado{all.length !== 1 ? "s" : ""} en los últimos {dateDays} días
            </span>
          )}
        </div>
      </div>

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {isFetching && (
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
          <style>{`
            @keyframes lupa-swing {
              0%   { transform: rotate(-15deg) scale(1);   }
              25%  { transform: rotate(15deg)  scale(1.1); }
              50%  { transform: rotate(-10deg) scale(1);   }
              75%  { transform: rotate(10deg)  scale(1.05);}
              100% { transform: rotate(-15deg) scale(1);   }
            }
            .lupa-anim { display:inline-block; animation: lupa-swing 1.2s ease-in-out infinite; font-size: 56px; }
            .magic-dots::after { content: ""; animation: magic-dot-anim 1.4s steps(1) infinite; }
            @keyframes magic-dot-anim { 0%{content:"."} 33%{content:".."} 66%{content:"..."} 100%{content:"."} }
          `}</style>
          <div className="lupa-anim">🔍</div>
          <p style={{ fontSize: 20, fontWeight: 900, marginTop: 20, color: "var(--text)" }}>
            Espera mientras la magia ocurre<span className="magic-dots magic-dot-anim" />
          </p>
          <p style={{ fontSize: 13, marginTop: 10 }}>Consultando fuentes en paralelo y analizando con IA</p>

          {/* Mini source indicators */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
            {sources.map(k => (
              <span key={k} style={{
                background: `${PCOLOR[k]}18`, color: PCOLOR[k],
                border: `1px solid ${PCOLOR[k]}40`,
                padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              }}>{PICON[k]} {PLABEL[k]}</span>
            ))}
          </div>
        </div>
      )}

      {isError && !isFetching && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "#f85149" }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>⚠️</p>
          <p style={{ fontWeight: 700, fontSize: 15 }}>Error al conectar con el servidor</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Revisa tu conexión e intenta de nuevo.</p>
        </div>
      )}

      {!query && !isFetching && (
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
          <p style={{ fontSize: 52, marginBottom: 16 }}>🔎</p>
          <p style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: "var(--text)" }}>Escribe cualquier keyword</p>
          <p style={{ fontSize: 13, marginBottom: 24 }}>Análisis completo con IA en ~5 segundos</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {['"Daniel Noboa"', 'Ecuador economía', 'Quito seguridad', 'Bitcoin'].map(ex => (
              <button key={ex} onClick={() => { setInput(ex); }}
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 20, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {!isFetching && data && s && (
        <>
          {/* KPI Row */}
          <div className="kpi-grid" style={{ marginBottom: 24 }}>
            <KpiCard icon={<BarChart2 size={18} />}  label="Menciones"   value={s.total}       color="var(--accent)"  sub={`"${data.query}"`} />
            <KpiCard icon={<span style={{fontSize:16}}>😊</span>} label="Positivo"    value={`${sentPct}%`} color="#3fb950"        sub={`${s.positive} menciones`} trend={sentPct > 50 ? "↑ Bueno" : undefined} />
            <KpiCard icon={<span style={{fontSize:16}}>😠</span>} label="Negativo"    value={`${negPct}%`}  color="#f85149"        sub={`${s.negative} menciones`} trend={negPct > 40 ? "↑ Alerta" : undefined} />
            <KpiCard icon={<Globe size={18} />}       label="Alcance"     value={s.reach}       color="#bc8cff"        sub="suma de seguidores" />
            <KpiCard icon={<Zap size={18} />}         label="Engagement"  value={s.engagement}  color="#e3b341"        sub="likes + RT + replies" />
          </div>

          {/* Main 2-col layout */}
          <div className="search-grid">

            {/* ── Feed ── */}
            <div>
              {/* Platform tabs */}
              <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 0, overflowX: "auto" }}>
                {[
                  { key: "all",      label: `Todos`, count: all.length },
                  { key: "twitter",  label: `𝕏 Twitter`,       count: byPlatform.twitter.length },
                  { key: "web",      label: `📰 Google News`,   count: byPlatform.web.length },
                  { key: "gnews_ec", label: `🇪🇨 EC`,           count: byPlatform.gnews_ec.length },
                  { key: "reddit",   label: `🟠 Reddit`,        count: byPlatform.reddit.length },
                  { key: "media",    label: `📺 Medios`,        count: byPlatform.media.length },
                ].map(({ key, label, count }) => (
                  <button key={key} onClick={() => setTab(key as any)} style={{
                    background:   "transparent",
                    color:        tab === key ? "var(--text)" : "var(--text-muted)",
                    border:       "none",
                    borderBottom: `2px solid ${tab === key ? "#58a6ff" : "transparent"}`,
                    padding:      "8px 14px",
                    fontSize:     13,
                    fontWeight:   tab === key ? 800 : 400,
                    cursor:       "pointer",
                    marginBottom: -1,
                    whiteSpace:   "nowrap",
                    display:      "flex", alignItems: "center", gap: 5,
                  }}>
                    {label}
                    <span style={{
                      background: tab === key ? "#58a6ff22" : "var(--bg)",
                      color:      tab === key ? "#58a6ff"   : "var(--text-muted)",
                      borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 700,
                    }}>{count}</span>
                  </button>
                ))}

                <select value={sentFilter} onChange={e => setSentFilter(e.target.value)}
                  style={{ marginLeft: "auto", fontSize: 12, padding: "4px 8px", alignSelf: "center", flexShrink: 0 }}>
                  <option value="">Todo sentimiento</option>
                  <option value="positive">😊 Positivo</option>
                  <option value="negative">😠 Negativo</option>
                  <option value="neutral">😐 Neutral</option>
                </select>
              </div>

              {filtered.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>🔍</p>
                  <p style={{ fontSize: 14 }}>Sin resultados para este filtro</p>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.map((r, i) => <ResultCard key={i} r={r} />)}
              </div>
            </div>

            {/* ── Sidebar ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Sentiment Donut */}
              <div className="card">
                <p style={{ fontWeight: 800, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                  <TrendingUp size={14} color="#58a6ff" /> Sentimiento
                </p>
                <DonutChart pos={pos} neg={neg} neu={neu} total={all.length} />

                {/* Legend */}
                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "Positivo", count: pos, color: "#3fb950", pct: sentPct },
                    { label: "Neutral",  count: neu, color: "#8b949e", pct: all.length > 0 ? Math.round(neu / all.length * 100) : 0 },
                    { label: "Negativo", count: neg, color: "#f85149", pct: negPct },
                  ].map(({ label, count, color, pct }) => (
                    <div key={label}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
                          <span style={{ color, fontWeight: 700 }}>{label}</span>
                        </span>
                        <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{count} · {pct}%</span>
                      </div>
                      <div style={{ height: 5, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width .7s ease" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Platform breakdown */}
              <div className="card">
                <p style={{ fontWeight: 800, fontSize: 13, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
                  <Globe size={14} color="#58a6ff" /> Por Plataforma
                </p>
                {SOURCE_KEYS.filter(k => byPlatform[k].length > 0).map(k => {
                  const pct = all.length > 0 ? Math.round(byPlatform[k].length / all.length * 100) : 0;
                  return (
                    <div key={k} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                        <span style={{ color: PCOLOR[k], fontWeight: 700 }}>{PICON[k]} {PLABEL[k]}</span>
                        <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{byPlatform[k].length} · {pct}%</span>
                      </div>
                      <div style={{ height: 5, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: PCOLOR[k], borderRadius: 4, transition: "width .7s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Top accounts */}
              {data.top_accounts.length > 0 && (
                <div className="card">
                  <p style={{ fontWeight: 800, fontSize: 13, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <Users size={14} color="#bc8cff" /> Principales Voces
                  </p>
                  {data.top_accounts.slice(0, 8).map((acc, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 10px", background: "var(--bg)", borderRadius: 8 }}>
                      {/* Rank badge */}
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: i < 3 ? ["#e3b341","#8b949e","#cd7f32"][i] + "30" : "var(--border)",
                        color:      i < 3 ? ["#e3b341","#8b949e","#cd7f32"][i]       : "var(--text-muted)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 900, flexShrink: 0,
                      }}>#{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: PCOLOR[acc.platform] }}>{PICON[acc.platform]}</span> {acc.author}
                        </p>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                          {acc.followers > 0 ? `${fmt(acc.followers)} seg · ` : ""}{acc.mention_count} menc.
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
