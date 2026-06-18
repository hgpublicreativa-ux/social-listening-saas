import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";

export default function Login() {
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
      const { data } = await login(email, pass);
      localStorage.setItem("token", data.access_token);
      nav("/");
    } catch {
      setErr("Email o contraseña incorrectos");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div className="fade-up" style={{ width: 380, maxWidth: "100%" }}>
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            background: "var(--grad-brand)",
            boxShadow: "0 8px 28px var(--accent-glow)",
            fontSize: 26,
          }}>📡</div>
          <h1 style={{
            fontSize: 26, fontWeight: 800,
            background: "var(--grad-brand)", WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>Social Listening</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>Monitoreo de tendencias en tiempo real</p>
        </div>

        <div className="card" style={{ padding: "26px 24px", boxShadow: "var(--shadow-lg)" }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6, fontWeight: 600 }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: "11px 13px" }} required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6, fontWeight: 600 }}>Contraseña</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: "100%", padding: "11px 13px" }} required />
            </div>
            {err && (
              <p style={{ color: "var(--red)", fontSize: 12, background: "rgba(248,81,73,.1)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(248,81,73,.2)" }}>
                ⚠ {err}
              </p>
            )}
            <button className="btn-primary" type="submit" disabled={busy} style={{ marginTop: 4, width: "100%", padding: "12px" }}>
              {busy ? "Iniciando…" : "Iniciar sesión"}
            </button>
          </form>
          <p style={{ marginTop: 18, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
            ¿Sin cuenta?{" "}
            <a href="/register" style={{ color: "var(--accent)", fontWeight: 600 }}>Registrarse</a>
          </p>
        </div>
      </div>
    </div>
  );
}
