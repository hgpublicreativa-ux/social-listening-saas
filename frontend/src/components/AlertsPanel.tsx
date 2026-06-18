import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAlerts, createAlert, deleteAlert } from "../api/client";
import { Bell, Plus, Trash2 } from "lucide-react";

interface Props { projectId: string }

const TRIGGER_TYPES = [
  { value: "spike",          label: "Pico de menciones" },
  { value: "sentiment_drop", label: "Caída de sentimiento" },
  { value: "keyword_hit",    label: "Keyword detectada" },
];

export default function AlertsPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", trigger_type: "spike", threshold: 100, window_minutes: 60, webhook_url: "",
  });

  const { data: rules = [] } = useQuery({
    queryKey: ["alerts", projectId],
    queryFn:  () => getAlerts(projectId),
    enabled:  !!projectId,
  });

  const create = useMutation({
    mutationFn: (data: object) => createAlert(projectId, data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["alerts", projectId] }); setShowForm(false); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAlert(projectId, id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["alerts", projectId] }),
  });

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bell size={16} color="#d29922" />
          <span style={{ fontWeight: 700 }}>Reglas de Alerta</span>
        </div>
        <button className="btn-ghost" onClick={() => setShowForm(!showForm)} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Plus size={13} /> Nueva
        </button>
      </div>

      {showForm && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="Nombre de la alerta" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.trigger_type} onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}>
            {TRIGGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="number" placeholder="Umbral" value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: +e.target.value })} style={{ flex: 1 }} />
            <input type="number" placeholder="Ventana (min)" value={form.window_minutes}
              onChange={(e) => setForm({ ...form, window_minutes: +e.target.value })} style={{ flex: 1 }} />
          </div>
          <input placeholder="Webhook URL (n8n, Zapier, etc.)" value={form.webhook_url}
            onChange={(e) => setForm({ ...form, webhook_url: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={() => create.mutate(form)}>Crear alerta</button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rules.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "12px 0" }}>
            Sin reglas configuradas
          </p>
        )}
        {rules.map((rule: any) => (
          <div key={rule.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "8px 12px",
          }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: 13 }}>{rule.name}</p>
              <p style={{ color: "var(--text-muted)", fontSize: 11 }}>
                {TRIGGER_TYPES.find((t) => t.value === rule.trigger_type)?.label}
                {rule.threshold ? ` · ≥ ${rule.threshold}` : ""}
                {` · ${rule.window_minutes}min`}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: rule.active ? "#3fb950" : "#8b949e",
                display: "inline-block",
              }} />
              <button onClick={() => remove.mutate(rule.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
