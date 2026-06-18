import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 340 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Crear cuenta</h1>
        </div>
        <div className="card">
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Contraseña</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: "100%" }} required minLength={8} />
            </div>
            {err && <p style={{ color: "var(--red)", fontSize: 12 }}>{err}</p>}
            <button className="btn-primary" type="submit" disabled={busy} style={{ marginTop: 4, width: "100%" }}>
              {busy ? "Creando cuenta..." : "Crear cuenta"}
            </button>
          </form>
          <p style={{ marginTop: 16, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
            ¿Ya tienes cuenta?{" "}
            <a href="/login" style={{ color: "var(--accent)" }}>Iniciar sesión</a>
          </p>
        </div>
      </div>
    </div>
  );
}
