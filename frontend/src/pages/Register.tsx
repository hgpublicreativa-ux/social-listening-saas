import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { register } from "../api/client";

export default function Register() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [err,   setErr]   = useState("");
  const [busy,  setBusy]  = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await register(email, pass);
      nav("/login");
    } catch (ex: any) {
      setErr(ex.response?.data?.detail || "Error al registrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, position: "relative", overflow: "hidden",
    }}>
      {/* ambient glow */}
      <div style={{ position: "absolute", bottom: "-10%", left: "-5%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,166,35,.12) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div className="fade-up" style={{ width: 388, maxWidth: "100%", position: "relative", zIndex: 1 }}>
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="brand-mark" style={{ width: 58, height: 58, margin: "0 auto 16px", borderRadius: 17 }}>
            <Activity size={28} strokeWidth={2.6} />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>Crear cuenta</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>Únete a <span className="gradient-text" style={{ fontWeight: 800 }}>PULSO</span></p>
        </div>

        <div className="card" style={{ padding: "28px 26px", boxShadow: "var(--shadow-lg)" }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6, fontWeight: 600 }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: "11px 13px" }} required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6, fontWeight: 600 }}>Contraseña</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: "100%", padding: "11px 13px" }} required minLength={8} />
              <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>Mínimo 8 caracteres</p>
            </div>
            {err && (
              <p style={{ color: "var(--red)", fontSize: 12, background: "rgba(248,113,113,.1)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(248,113,113,.2)" }}>
                ⚠ {err}
              </p>
            )}
            <button className="btn-primary" type="submit" disabled={busy} style={{ marginTop: 4, width: "100%", padding: "12px" }}>
              {busy ? "Creando cuenta…" : "Crear cuenta"}
            </button>
          </form>
          <p style={{ marginTop: 18, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
            ¿Ya tienes cuenta?{" "}
            <a href="/login" style={{ color: "var(--accent)", fontWeight: 700 }}>Iniciar sesión</a>
          </p>
        </div>
      </div>
    </div>
  );
}
