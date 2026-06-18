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
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg)",
    }}>
      <div style={{ width: 340 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Social Listening</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Monitoreo de tendencias en tiempo real</p>
        </div>

        <div className="card">
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Contraseña</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: "100%" }} required />
            </div>
            {err && <p style={{ color: "var(--red)", fontSize: 12 }}>{err}</p>}
            <button className="btn-primary" type="submit" disabled={busy} style={{ marginTop: 4, width: "100%" }}>
              {busy ? "Iniciando..." : "Iniciar sesión"}
            </button>
          </form>
          <p style={{ marginTop: 16, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
            ¿Sin cuenta?{" "}
            <a href="/register" style={{ color: "var(--accent)" }}>Registrarse</a>
          </p>
        </div>
      </div>
    </div>
  );
}
