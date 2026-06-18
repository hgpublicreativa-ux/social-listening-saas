import React, { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Search, ExternalLink, RefreshCw } from "lucide-react";

const PLATFORM_ICON: Record<string, string> = {
  twitter: "𝕏",
  web:     "📰",
  bluesky: "☁",
};

const SOURCE_COLORS: Record<string, string> = {
  twitter: "#1d9bf0",
  web:     "#58a6ff",
  bluesky: "#0085ff",
};

const SOURCE_LABELS = [
  { key: "twitter", label: "X / Twitter" },
  { key: "web",     label: "Google News" },
  { key: "bluesky", label: "Bluesky" },
];

interface Result {
  platform:    string;
  title:       string;
  text:        string;
  url:         string;
  author:      string;
  published_at: string;
  likes:       number;
  shares:      number;
  comments:    number;
  source:      string;
}

const fetchSearch = (q: string, sources: string[]): Promise<Result[]> =>
  api.get("/search", { params: { q, sources: sources.join(",") } }).then(r => r.data);

export default function SearchPage() {
  const [input,   setInput]   = useState("");
  const [query,   setQuery]   = useState("");
  const [sources, setSources] = useState(["twitter", "web", "bluesky"]);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data = [], isFetching, isError, refetch } = useQuery({
    queryKey:  ["live-search", query, sources.join(",")],
    queryFn:   () => fetchSearch(query, sources),
    enabled:   !!query,
    staleTime: 60_000,
    retry:     1,
  });

  const handleSearch = () => {
    const q = input.trim();
    if (!q) return;
    setQuery(q);
  };

  const toggleSource = (key: string) => {
    setSources(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    );
  };

  return (
    <div style={{ padding: "32px 40px", maxWidth: 860 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Búsqueda en Tiempo Real</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Busca cualquier keyword en X, Google News y Bluesky al instante.
        </p>
      </div>

      {/* Search bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search
            size={16}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
          />
          <input
            ref={inputRef}
            placeholder="Ej: Daniel Noboa, bitcoin, Ecuador elecciones..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            style={{ width: "100%", paddingLeft: 38, fontSize: 15, padding: "10px 14px 10px 38px" }}
            autoFocus
          />
        </div>
        <button
          className="btn-primary"
          onClick={handleSearch}
          disabled={!input.trim() || isFetching}
          style={{ padding: "10px 24px", fontSize: 14, whiteSpace: "nowrap" }}
        >
          {isFetching ? "Buscando..." : "Buscar"}
        </button>
      </div>

      {/* Source filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Fuentes:</span>
        {SOURCE_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => toggleSource(key)}
            style={{
              background:   sources.includes(key) ? `${SOURCE_COLORS[key]}22` : "var(--bg)",
              color:        sources.includes(key) ? SOURCE_COLORS[key] : "var(--text-muted)",
              border:       `1px solid ${sources.includes(key) ? SOURCE_COLORS[key] : "var(--border)"}`,
              borderRadius: 6,
              padding:      "4px 12px",
              fontSize:     12,
              cursor:       "pointer",
            }}
          >
            {PLATFORM_ICON[key]} {label}
          </button>
        ))}
        {query && !isFetching && (
          <button
            onClick={() => refetch()}
            style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
          >
            <RefreshCw size={12} /> Actualizar
          </button>
        )}
      </div>

      {/* State messages */}
      {isFetching && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
          <p>Buscando en X, Google News y Bluesky...</p>
        </div>
      )}

      {isError && !isFetching && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#f85149" }}>
          Error al buscar. Verifica conexión y vuelve a intentar.
        </div>
      )}

      {!isFetching && query && data.length === 0 && !isError && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <p style={{ fontSize: 28, marginBottom: 12 }}>🤷</p>
          <p>Sin resultados para "<strong>{query}</strong>"</p>
        </div>
      )}

      {!query && !isFetching && (
        <div style={{ textAlign: "center", padding: "64px 0", color: "var(--text-muted)" }}>
          <p style={{ fontSize: 40, marginBottom: 16 }}>🔎</p>
          <p style={{ fontSize: 15 }}>Escribe una keyword y presiona Enter</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>Resultados en ~3 segundos desde múltiples fuentes</p>
        </div>
      )}

      {/* Results */}
      {!isFetching && data.length > 0 && (
        <>
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 14 }}>
            {data.length} resultados para "<strong style={{ color: "var(--text)" }}>{query}</strong>"
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.map((r, i) => (
              <div key={i} className="card" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: SOURCE_COLORS[r.platform] || "var(--accent)", fontWeight: 700 }}>
                      {PLATFORM_ICON[r.platform] || "•"} {r.platform}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>· {r.author}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      {r.published_at
                        ? formatDistanceToNow(parseISO(r.published_at), { addSuffix: true, locale: es })
                        : ""}
                    </span>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)" }}>
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>

                {r.title && r.title !== r.author && r.platform === "web" && (
                  <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, lineHeight: 1.4 }}>{r.title}</p>
                )}
                <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, wordBreak: "break-word" }}>
                  {r.text}
                </p>

                {(r.likes > 0 || r.shares > 0 || r.comments > 0) && (
                  <div style={{ display: "flex", gap: 14, marginTop: 10, color: "var(--text-muted)", fontSize: 11 }}>
                    <span>❤ {r.likes.toLocaleString()}</span>
                    <span>🔁 {r.shares.toLocaleString()}</span>
                    <span>💬 {r.comments.toLocaleString()}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
