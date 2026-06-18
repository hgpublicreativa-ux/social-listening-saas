import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getProjects, createProject, deleteProject } from "../api/client";
import { Plus, Trash2, Radio } from "lucide-react";

interface Props { onSelect: (id: string, name: string) => void }

const SOURCES = ["twitter", "youtube", "tiktok", "facebook", "web"];

export default function ProjectsPage({ onSelect }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", keywords: "", sources: ["twitter", "youtube"], language: "es" });

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn:  getProjects,
  });

  const create = useMutation({
    mutationFn: () => createProject({
      name:     form.name,
      keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      sources:  form.sources,
      language: form.language,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); setShowForm(false); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (window.confirm(`¿Eliminar el proyecto "${name}"? Esta acción no se puede deshacer.`)) {
      remove.mutate(id);
    }
  };

  const toggleSource = (s: string) => {
    setForm((prev) => ({
      ...prev,
      sources: prev.sources.includes(s) ? prev.sources.filter((x) => x !== s) : [...prev.sources, s],
    }));
  };

  return (
    <div style={{ padding: "32px 40px", maxWidth: 800 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Proyectos de Monitoreo</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Cada proyecto rastrea un set de keywords en tus plataformas.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> Nuevo proyecto
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p style={{ fontWeight: 600, marginBottom: 14 }}>Nuevo Proyecto</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input placeholder="Nombre del proyecto (ej. Bad Bunny Trending)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Keywords separadas por coma (ej. Bad Bunny, reggaeton, trap latino)" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
            <div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Fuentes</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SOURCES.map((s) => (
                  <button key={s} onClick={() => toggleSource(s)} style={{
                    background: form.sources.includes(s) ? "rgba(88,166,255,.15)" : "var(--bg)",
                    color: form.sources.includes(s) ? "#58a6ff" : "var(--text-muted)",
                    border: `1px solid ${form.sources.includes(s) ? "#58a6ff" : "var(--border)"}`,
                    borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer",
                  }}>{s}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={() => create.mutate()} disabled={!form.name || !form.keywords}>
                Crear proyecto
              </button>
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {isLoading && <p style={{ color: "var(--text-muted)" }}>Cargando proyectos...</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {projects.map((p: any) => (
          <div key={p.id} className="card" style={{ cursor: "pointer", transition: "border-color .15s" }}
            onClick={() => onSelect(p.id, p.name)}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#58a6ff")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Radio size={14} color={p.active ? "#3fb950" : "#8b949e"} />
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
                  {p.keywords.join(", ")}
                </p>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {p.sources.map((s: string) => (
                    <span key={s} style={{
                      background: "var(--bg)", border: "1px solid var(--border)",
                      borderRadius: 4, padding: "1px 8px", fontSize: 10,
                    }}>{s}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ color: "var(--accent)", fontSize: 12 }}>Ver dashboard →</span>
                <button
                  onClick={(e) => handleDelete(e, p.id, p.name)}
                  disabled={remove.isPending}
                  title="Eliminar proyecto"
                  style={{
                    background: "transparent", border: "1px solid var(--border)",
                    borderRadius: 6, padding: "6px 8px", cursor: "pointer",
                    color: "#8b949e", display: "flex", alignItems: "center",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#f85149"; e.currentTarget.style.color = "#f85149"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "#8b949e"; }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {!isLoading && projects.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>📡</p>
            <p>Crea tu primer proyecto para empezar a monitorear</p>
          </div>
        )}
      </div>
    </div>
  );
}
