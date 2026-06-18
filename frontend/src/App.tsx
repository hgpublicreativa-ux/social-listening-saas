import React, { useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Bell, Settings, LogOut, Radio } from "lucide-react";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProjectsPage from "./pages/ProjectsPage";
import Dashboard from "./components/Dashboard";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Sidebar({ onNav, activeView }: { onNav: (v: string) => void; activeView: string }) {
  const navigate = useNavigate();
  const navItems = [
    { id: "projects", icon: <FolderKanban size={18} />, label: "Proyectos" },
    { id: "dashboard", icon: <LayoutDashboard size={18} />, label: "Dashboard" },
  ];

  return (
    <aside style={{
      width: 56, background: "var(--surface)", borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "16px 0", gap: 4, flexShrink: 0,
    }}>
      <div style={{ marginBottom: 20, color: "#58a6ff" }}>
        <Radio size={22} />
      </div>
      {navItems.map((item) => (
        <button key={item.id} onClick={() => onNav(item.id)} title={item.label} style={{
          width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
          background: activeView === item.id ? "rgba(88,166,255,.15)" : "transparent",
          color: activeView === item.id ? "#58a6ff" : "var(--text-muted)",
          border: "none", borderRadius: 8, cursor: "pointer", transition: "background .15s, color .15s",
        }}>
          {item.icon}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button onClick={() => { localStorage.removeItem("token"); navigate("/login"); }} title="Cerrar sesión" style={{
        width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", color: "var(--text-muted)", border: "none", borderRadius: 8, cursor: "pointer",
      }}>
        <LogOut size={18} />
      </button>
    </aside>
  );
}

function AppShell() {
  const [view,        setView]        = useState("projects");
  const [projectId,   setProjectId]   = useState("");
  const [projectName, setProjectName] = useState("");

  const handleSelectProject = (id: string, name: string) => {
    setProjectId(id);
    setProjectName(name);
    setView("dashboard");
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar onNav={setView} activeView={view} />
      <main style={{ flex: 1, overflowY: "auto" }}>
        {view === "projects" && <ProjectsPage onSelect={handleSelectProject} />}
        {view === "dashboard" && projectId
          ? <Dashboard projectId={projectId} projectName={projectName} />
          : view === "dashboard" && (
            <div style={{ padding: 40, color: "var(--text-muted)", textAlign: "center" }}>
              <p style={{ fontSize: 24, marginBottom: 8 }}>📊</p>
              <p>Selecciona un proyecto primero</p>
              <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => setView("projects")}>
                Ver proyectos
              </button>
            </div>
          )
        }
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/*"        element={<RequireAuth><AppShell /></RequireAuth>} />
    </Routes>
  );
}
