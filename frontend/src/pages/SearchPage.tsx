import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatDistanceToNow, parseISO, subDays, isAfter } from "date-fns";
import { es } from "date-fns/locale";
import { Search, ExternalLink, RefreshCw, Users, TrendingUp, Calendar, MessageCircle, Heart, Repeat2, Eye, Zap, Globe, BarChart2 } from "lucide-react";
import TrendingWidget from "../components/TrendingWidget";

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
const PCOLOR: Record<string, string> = { twitter: "#5b9df0", web: "#7aa2ff", reddit: "#ff6a3d", media: "#f5a623", gnews_ec: "#34d399" };
const PLABEL: Record<string, string> = { twitter: "X / Twitter", web: "Google News", reddit: "Reddit", media: "Medios monitoreados", gnews_ec: "Noticias Ecuador" };

const SENT_COLOR: Record<string, string> = { positive: "#34d399", negative: "#f87171", neutral: "#9aa1b0" };
const SENT_BG: Record<string, string>    = { positive: "rgba(52,211,153,.15)", negative: "rgba(248,113,113,.15)", neutral: "rgba(154,161,176,.12)" };
const SENT_LABEL: Record<string, string> = { positive: "Positivo", negative: "Negativo", neutral: "Neutral" };
const SENT_EMOJI: Record<string, string> = { positive: "😊", negative: "😠", neutral: "😐" };

const SOURCE_KEYS = ["twitter", "web", "reddit", "gnews_ec", "media"] as const;
const DATE_PRESETS = [{ label: "7d", days: 7 }, { label: "14d", days: 14 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }];

// ── Helpers ───────────────────────────────────────────────────────────────────
const doSearch = (q: string, sources: string[], dateFrom?: string): Promise<SearchResponse> =>
  api.get("/search", { params: { q, sources: sources.join(","), ...(dateFrom ? { date_from: dateFrom } : {}) } }).then(r => r.data);

function filterByRange(
  results: EnrichedResult[],
  days: number,
  dateFrom: string,
  dateTo: string,
): EnrichedResult[] {
  if (dateFrom || dateTo) {
    const fromD = dateFrom ? new Date(dateFrom) : null;
    const toD   = dateTo   ? new Date(dateTo + "T23:59:59") : null;
    return results.filter(r => {
      try {
        const d = parseISO(r.published_at);
        if (fromD && d < fromD) return false;
        if (toD   && d > toD)   return false;
        return true;
      } catch { return true; }
    });
  }
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
    #34d399 0% ${pPct}%,
    #f87171 ${pPct}% ${pPct + nPct}%,
    #9aa1b0 ${pPct + nPct}% 100%
  )`;
  return (
    <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto" }}>
      <div style={{ width: 120, height: 120, borderRadius: "50%", background: gradient, boxShadow: "0 6px 22px rgba(0,0,0,.4)" }} />
      {/* hole */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        width: 70, height: 70, borderRadius: "50%",
        background: "var(--surface)", border: "1px solid var(--border)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", lineHeight: 1 }}>{pPct}%</span>
        <span style={{ fontSize: 9, color: "var(--green)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", marginTop: 2 }}>pos</span>
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
  // News items expose the link via the (clickable) headline; only posts without
  // a title keep the small corner icon to reach the source.
  const hasTitle  = !!r.title && isNews && r.title !== r.author;
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
          {r.url && !hasTitle && (
            <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)", display: "flex" }} title="Abrir fuente">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {/* Title — clickable link to the article */}
      {hasTitle && (
        r.url ? (
          <a href={r.url} target="_blank" rel="noreferrer" className="title-link"
            style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, fontWeight: 800, fontSize: 15, marginBottom: 8, lineHeight: 1.4 }}>
            <span>{r.title}</span>
            <ExternalLink size={13} style={{ flexShrink: 0, marginTop: 3, opacity: .65 }} />
          </a>
        ) : (
          <p style={{ fontWeight: 800, fontSize: 15, marginBottom: 8, color: "var(--text)", lineHeight: 1.4 }}>{r.title}</p>
        )
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


      {/* Keywords */}
      {r.keywords?.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: r.likes || r.shares || r.comments ? 10 : 0 }}>
          {r.keywords.slice(0, 5).map((kw, i) => (
            <span key={i} style={{
              background: "var(--accent-soft)", color: "var(--accent)",
              padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700,
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
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");

  const { data, isFetching, isError, refetch } = useQuery<SearchResponse>({
    queryKey:  ["live-search", query, sources.join(","), dateFrom],
    queryFn:   () => doSearch(query, sources, dateFrom || undefined),
    enabled:   !!query,
    staleTime: 120_000,
    retry:     1,
  });

  const go = () => {
    const q = input.trim();
    if (!q) return;
    setSentFilter("");
    setDateDays(60);
    setDateFrom("");
    setDateTo("");
    setTab("all");
    setQuery(q);
  };

  const toggleSrc = (k: string) =>
    setSources(p => p.includes(k) ? p.filter(s => s !== k) : [...p, k]);

  const all = filterByRange(data?.results ?? [], dateDays, dateFrom, dateTo);
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

  // ── Shared search controls (used both in hero and compact bar) ────────────
  const searchBar = (heroMode: boolean) => (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input
            placeholder='"Daniel Noboa", bitcoin, Ecuador elecciones...'
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && go()}
            style={{
              width: "100%", paddingLeft: 40, fontSize: heroMode ? 16 : 14,
              padding: heroMode ? "14px 16px 14px 40px" : "11px 14px 11px 36px",
              boxShadow: heroMode ? "0 0 0 1px var(--border-soft), 0 8px 32px rgba(0,0,0,.4)" : undefined,
            }}
            autoFocus
          />
        </div>
        <button className="btn-primary" onClick={go} disabled={!input.trim() || isFetching}
          style={{ padding: heroMode ? "14px 32px" : "11px 28px", fontSize: heroMode ? 15 : 14, whiteSpace: "nowrap", fontWeight: 700 }}>
          {isFetching ? "Analizando…" : "🔍 Buscar"}
        </button>
      </div>

      {/* Sources */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap", marginBottom: heroMode ? 0 : 10, overflowX: "auto" }}>
        {SOURCE_KEYS.map(k => (
          <button key={k} onClick={() => toggleSrc(k)} style={{
            background:   sources.includes(k) ? `${PCOLOR[k]}20` : "transparent",
            color:        sources.includes(k) ? PCOLOR[k] : "var(--text-muted)",
            border:       `1px solid ${sources.includes(k) ? PCOLOR[k] : "var(--border)"}`,
            borderRadius: 20, padding: "4px 12px", fontSize: 12, cursor: "pointer",
            fontWeight:   sources.includes(k) ? 700 : 400,
            transition:   "all .15s", whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {PICON[k]} {PLABEL[k]}
          </button>
        ))}
        {data && !isFetching && !heroMode && (
          <button onClick={() => refetch()} style={{
            marginLeft: "auto", background: "transparent", border: "none",
            color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12,
          }}>
            <RefreshCw size={11} /> Actualizar
          </button>
        )}
      </div>
    </div>
  );

  const dateControls = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <Calendar size={13} color="var(--text-muted)" />
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Período:</span>
      {DATE_PRESETS.map(({ label, days }) => (
        <button key={days}
          onClick={() => { setDateDays(days); setDateFrom(""); setDateTo(""); }}
          disabled={!data}
          className={dateDays === days && !dateFrom && !dateTo ? "btn-primary" : "btn-ghost"}
          style={{ padding: "3px 12px", fontSize: 12, opacity: !data ? 0.4 : 1, fontWeight: 600 }}>
          {label}
        </button>
      ))}
      <span style={{ color: "var(--border-strong)", fontSize: 14, margin: "0 2px" }}>|</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="date" value={dateFrom} disabled={!data}
          onChange={e => { setDateFrom(e.target.value); setDateDays(0); }}
          style={{ fontSize: 11, padding: "3px 8px", background: "var(--surface-2)", border: `1px solid ${dateFrom ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, color: "var(--text)", cursor: "pointer", opacity: !data ? 0.4 : 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>→</span>
        <input type="date" value={dateTo} disabled={!data}
          onChange={e => { setDateTo(e.target.value); setDateDays(0); }}
          style={{ fontSize: 11, padding: "3px 8px", background: "var(--surface-2)", border: `1px solid ${dateTo ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, color: "var(--text)", cursor: "pointer", opacity: !data ? 0.4 : 1 }} />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setDateDays(60); }}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, padding: "0 2px" }}
            title="Limpiar rango">✕</button>
        )}
      </div>
      {data && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
          · <strong style={{ color: "var(--text)" }}>{all.length}</strong> resultado{all.length !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );

  return (
    <div>

    {/* ── HERO (only when no search yet) ────────────────────────────────── */}
    {!query && !isFetching && (
      <div style={{ position: "relative", overflow: "hidden", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{`
          @keyframes orb-float-1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(40px,-30px) scale(1.08)} 66%{transform:translate(-20px,20px) scale(.96)} }
          @keyframes orb-float-2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-50px,25px) scale(1.05)} 66%{transform:translate(30px,-15px) scale(.98)} }
          @keyframes orb-float-3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(20px,35px) scale(1.06)} }
          @keyframes hero-fade-up { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
          @keyframes badge-pulse  { 0%,100%{box-shadow:0 0 0 0 rgba(245,166,35,.4)} 50%{box-shadow:0 0 0 6px rgba(245,166,35,0)} }
          @keyframes grid-drift   { from{background-position:0 0} to{background-position:40px 40px} }
          @keyframes ticker-scroll { from{transform:translateX(0)} to{transform:translateX(-50%)} }
          .hero-title  { animation: hero-fade-up .7s ease both; }
          .hero-sub    { animation: hero-fade-up .7s .12s ease both; }
          .hero-stats  { animation: hero-fade-up .7s .22s ease both; }
          .hero-search { animation: hero-fade-up .7s .32s ease both; }
          .hero-chips  { animation: hero-fade-up .7s .42s ease both; }
          .live-badge  { animation: badge-pulse 2s ease-in-out infinite; }
        `}</style>

        {/* Animated grid */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          opacity: 0.25,
          animation: "grid-drift 8s linear infinite",
        }} />

        {/* Orbs */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "8%",  left: "12%",  width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,166,35,.16) 0%, transparent 70%)", animation: "orb-float-1 12s ease-in-out infinite" }} />
          <div style={{ position: "absolute", top: "45%", right: "8%",  width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(251,146,60,.12) 0%, transparent 70%)", animation: "orb-float-2 15s ease-in-out infinite" }} />
          <div style={{ position: "absolute", bottom: "10%", left: "35%", width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(91,157,240,.08) 0%, transparent 70%)", animation: "orb-float-3 10s ease-in-out infinite" }} />
        </div>

        {/* Hero content */}
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "40px 24px", maxWidth: 720, width: "100%" }}>

          {/* Wordmark + kicker */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 18 }}>
            <span className="gradient-text" style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22, letterSpacing: "0.04em" }}>PULSO</span>
            <span style={{ width: 1, height: 16, background: "var(--border-strong)" }} />
            <span className="kicker">Inteligencia de medios</span>
          </div>

          {/* Live badge */}
          <div className="live-badge" style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            background: "rgba(245,166,35,.10)", border: "1px solid rgba(245,166,35,.32)",
            borderRadius: 20, padding: "5px 14px", marginBottom: 26, fontSize: 11, fontWeight: 700,
            color: "var(--accent)", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block", boxShadow: "0 0 7px var(--green)" }} />
            En tiempo real · IA activa
          </div>

          {/* Headline */}
          <h1 className="hero-title" style={{
            fontSize: "clamp(32px, 5.4vw, 58px)", fontWeight: 900, lineHeight: 1.04,
            marginBottom: 16, letterSpacing: "-0.02em",
          }}>
            <span className="gradient-text">El pulso de la conversación</span>
            <br />
            <span style={{ color: "var(--text)" }}>antes que nadie</span>
          </h1>

          <p className="hero-sub" style={{ color: "var(--text-muted)", fontSize: "clamp(14px, 1.6vw, 17px)", maxWidth: 520, margin: "0 auto 24px", lineHeight: 1.6 }}>
            Monitorea medios, redes y noticias del Ecuador en un solo lugar. Sentimiento, alcance y voces clave analizados con IA al instante.
          </p>

          {/* Search bar */}
          <div className="hero-search" style={{ marginBottom: 20 }}>
            {searchBar(true)}
          </div>

          {/* Example chips */}
          <div className="hero-chips" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Prueba:</span>
            {['"Daniel Noboa"', 'Ecuador economía', 'Quito seguridad', 'Bitcoin'].map(ex => (
              <button key={ex} onClick={() => { setInput(ex); }}
                style={{
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  color: "var(--text-muted)", borderRadius: 20, padding: "5px 14px",
                  fontSize: 12, cursor: "pointer", transition: "all .15s",
                }}>
                {ex}
              </button>
            ))}
          </div>

          {/* Feature tags */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 40 }}>
            {[
              { icon: "⚡", text: "Búsqueda paralela" },
              { icon: "🧠", text: "Análisis semántico" },
              { icon: "📊", text: "Sentimiento IA" },
              { icon: "🇪🇨", text: "Foco Ecuador" },
              { icon: "🔴", text: "Sin polling" },
            ].map(({ icon, text }) => (
              <span key={text} style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, color: "var(--text-dim)",
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "4px 10px",
              }}>{icon} {text}</span>
            ))}
          </div>
        </div>
      </div>
    )}

    {/* ── Compact header (after search) ────────────────────────────────── */}
    {(query || isFetching) && (
      <div className="page-pad" style={{ paddingBottom: 0 }}>
        <div style={{ marginBottom: 16 }}>
          {searchBar(false)}
          <div style={{ marginTop: 10 }}>{dateControls}</div>
        </div>
      </div>
    )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {isFetching && (
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
          <style>{`
            /* Lupa mágica — halo deslumbrante, anillo de luz y chispas en órbita */
            .lupa-stage { position: relative; width: 156px; height: 156px; margin: 0 auto 4px; display: flex; align-items: center; justify-content: center; }

            .lupa-halo {
              position: absolute; inset: -8px; border-radius: 50%;
              background: radial-gradient(circle, rgba(245,166,35,.40) 0%, rgba(245,166,35,.12) 42%, transparent 70%);
              animation: halo-pulse 2.2s ease-in-out infinite;
            }
            @keyframes halo-pulse { 0%,100%{ opacity:.45; transform:scale(.82); } 50%{ opacity:1; transform:scale(1.18); } }

            .lupa-ring {
              position: absolute; inset: 4px; border-radius: 50%;
              background: conic-gradient(from 0deg, transparent 0deg, rgba(252,211,77,0) 50deg, rgba(252,211,77,.75) 120deg, rgba(245,166,35,0) 210deg, transparent 360deg);
              filter: blur(10px);
              animation: ring-spin 3.6s linear infinite;
            }
            @keyframes ring-spin { to { transform: rotate(360deg); } }

            .lupa-orbit { position: absolute; inset: 0; animation: orbit-spin 7s linear infinite; }
            @keyframes orbit-spin { to { transform: rotate(360deg); } }
            .spark { position: absolute; color: var(--accent-2); filter: drop-shadow(0 0 6px rgba(252,211,77,.9)); }
            .spark.s1 { top: -2px;  left: 50%; margin-left: -9px; font-size: 18px; animation: twinkle 1.4s 0s    ease-in-out infinite; }
            .spark.s2 { right: -2px; top: 50%; margin-top: -8px;  font-size: 13px; animation: twinkle 1.4s .35s  ease-in-out infinite; }
            .spark.s3 { bottom: -2px;left: 50%; margin-left: -9px; font-size: 16px; animation: twinkle 1.4s .7s   ease-in-out infinite; }
            .spark.s4 { left: -2px;  top: 50%; margin-top: -8px;  font-size: 14px; animation: twinkle 1.4s 1.05s ease-in-out infinite; }
            @keyframes twinkle { 0%,100%{ opacity:.25; transform:scale(.5); } 50%{ opacity:1; transform:scale(1.25); } }

            .lupa-glyph {
              position: relative; z-index: 2; font-size: 62px; line-height: 1;
              animation: lupa-float 2.6s ease-in-out infinite, lupa-glow 1.8s ease-in-out infinite;
            }
            @keyframes lupa-float { 0%,100%{ transform: translateY(0) rotate(-7deg); } 50%{ transform: translateY(-9px) rotate(7deg); } }
            @keyframes lupa-glow {
              0%,100%{ filter: drop-shadow(0 0 6px rgba(245,166,35,.5)); }
              50%    { filter: drop-shadow(0 0 22px rgba(252,211,77,.95)) drop-shadow(0 0 44px rgba(245,166,35,.6)); }
            }

            .magic-dots::after { content: ""; animation: magic-dot-anim 1.4s steps(1) infinite; }
            @keyframes magic-dot-anim { 0%{content:"."} 33%{content:".."} 66%{content:"..."} 100%{content:"."} }
          `}</style>
          <div className="lupa-stage">
            <div className="lupa-halo" />
            <div className="lupa-ring" />
            <div className="lupa-orbit">
              <span className="spark s1">✨</span>
              <span className="spark s2">✦</span>
              <span className="spark s3">★</span>
              <span className="spark s4">✦</span>
            </div>
            <div className="lupa-glyph">🔍</div>
          </div>
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
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--red)", margin: "0 24px" }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>⚠️</p>
          <p style={{ fontWeight: 700, fontSize: 15 }}>Error al conectar con el servidor</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Revisa tu conexión e intenta de nuevo.</p>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {!isFetching && data && s && (
        <div className="page-pad" style={{ paddingTop: 0 }}>
          {/* KPI Row */}
          <div className="kpi-grid" style={{ marginBottom: 24 }}>
            <KpiCard icon={<BarChart2 size={18} />}  label="Menciones"   value={s.total}       color="var(--accent)"  sub={`"${data.query}"`} />
            <KpiCard icon={<span style={{fontSize:16}}>😊</span>} label="Positivo"    value={`${sentPct}%`} color="var(--green)"   sub={`${s.positive} menciones`} trend={sentPct > 50 ? "↑ Bueno" : undefined} />
            <KpiCard icon={<span style={{fontSize:16}}>😠</span>} label="Negativo"    value={`${negPct}%`}  color="var(--red)"     sub={`${s.negative} menciones`} trend={negPct > 40 ? "↑ Alerta" : undefined} />
            <KpiCard icon={<Globe size={18} />}       label="Alcance"     value={s.reach}       color="var(--violet)"  sub="suma de seguidores" />
            <KpiCard icon={<Zap size={18} />}         label="Engagement"  value={s.engagement}  color="var(--teal)"    sub="likes + RT + replies" />
          </div>

          {/* Main 2-col layout */}
          <div className="search-grid">

            {/* ── Feed ── */}
            <div>
              {/* Platform tabs */}
              <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 0, overflowX: "auto" }}>
                {[
                  { key: "all",      label: `Todos`,                      count: all.length },
                  { key: "twitter",  label: `𝕏 Twitter`,                  count: byPlatform.twitter.length },
                  { key: "web",      label: `📰 Google News`,              count: byPlatform.web.length },
                  { key: "reddit",   label: `🟠 Reddit`,                   count: byPlatform.reddit.length },
                  { key: "gnews_ec", label: `🇪🇨 Noticias Ecuador`,        count: byPlatform.gnews_ec.length },
                  { key: "media",    label: `📺 Medios monitoreados`,      count: byPlatform.media.length },
                ].map(({ key, label, count }) => (
                  <button key={key} onClick={() => setTab(key as any)} style={{
                    background:   "transparent",
                    color:        tab === key ? "var(--text)" : "var(--text-muted)",
                    border:       "none",
                    borderBottom: `2px solid ${tab === key ? "var(--accent)" : "transparent"}`,
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
                      background: tab === key ? "var(--accent-soft)" : "var(--bg)",
                      color:      tab === key ? "var(--accent)"      : "var(--text-muted)",
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
                <p className="section-title" style={{ marginBottom: 16 }}>
                  <TrendingUp size={15} color="var(--accent)" /> Sentimiento
                </p>
                <DonutChart pos={pos} neg={neg} neu={neu} total={all.length} />

                {/* Legend */}
                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "Positivo", count: pos, color: "var(--green)",   pct: sentPct },
                    { label: "Neutral",  count: neu, color: "var(--neutral)", pct: all.length > 0 ? Math.round(neu / all.length * 100) : 0 },
                    { label: "Negativo", count: neg, color: "var(--red)",     pct: negPct },
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
                <p className="section-title" style={{ marginBottom: 14 }}>
                  <Globe size={15} color="var(--accent)" /> Por Plataforma
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

              {/* Trending keywords */}
              {all.length > 0 && (
                <TrendingWidget
                  results={all}
                  onTrendingClick={(kw) => {
                    setInput(kw);
                    setQuery(kw);
                    setSentFilter("");
                    setDateDays(60);
                    setDateFrom("");
                    setDateTo("");
                    setTab("all");
                  }}
                />
              )}

              {/* Top accounts */}
              {data.top_accounts.length > 0 && (
                <div className="card">
                  <p className="section-title" style={{ marginBottom: 14 }}>
                    <Users size={15} color="var(--violet)" /> Principales Voces
                  </p>
                  {data.top_accounts.slice(0, 8).map((acc, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 10px", background: "var(--bg)", borderRadius: 8 }}>
                      {/* Rank badge */}
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: i < 3 ? ["#f5a623","#c0c6d4","#cd7f32"][i] + "30" : "var(--border)",
                        color:      i < 3 ? ["#f5a623","#c0c6d4","#cd7f32"][i]       : "var(--text-muted)",
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
        </div>
      )}
    </div>
  );
}
