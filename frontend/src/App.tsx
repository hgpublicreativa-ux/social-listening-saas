import React, { useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Search, LogOut, Radio } from "lucide-react";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProjectsPage from "./pages/ProjectsPage";
import Dashboard from "./components/Dashboard";
import SearchPage from "./pages/SearchPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const NAV_ITEMS = [
  { id: "search",    icon: <Search size={18} />,          label: "Búsqueda" },
  { id: "projects",  icon: <FolderKanban size={18} />,    label: "Proyectos" },
  { id: "dashboard", icon: <LayoutDashboard size={18} />, label: "Dashboard" },
];

function Sidebar({ onNav, activeView }: { onNav: (v: string) => void; activeView: string }) {
  const navigate = useNavigate();
  return (
    <aside className="app-sidebar">
      <div style={{ marginBottom: 20, color: "#58a6ff" }}>
        <Radio size={22} />
      </div>
      {NAV_ITEMS.map((item) => (
        <button key={item.id} onClick={() => onNav(item.id)} title={item.label} style={{
          width: 40, height: 40,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: activeView === item.id ? "rgba(88,166,255,.15)" : "transparent",
          color: activeView === item.id ? "#58a6ff" : "var(--text-muted)",
          border: "none", borderRadius: 8, cursor: "pointer",
          transition: "background .15s, color .15s",
        }}>
          {item.icon}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button onClick={() => { localStorage.removeItem("token"); navigate("/login"); }} title="Cerrar sesión" style={{
        width: 40, height: 40,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", color: "var(--text-muted)",
        border: "none", borderRadius: 8, cursor: "pointer",
      }}>
        <LogOut size={18} />
      </button>
    </aside>
  );
}

function BottomNav({ onNav, activeView }: { onNav: (v: string) => void; activeView: string }) {
  const navigate = useNavigate();
  const all = [...NAV_ITEMS, { id: "logout", icon: <LogOut size={18} />, label: "Salir" }];
  return (
    <nav className="bottom-nav">
      {all.map((item) => (
        <button key={item.id} onClick={() => {
          if (item.id === "logout") { localStorage.removeItem("token"); navigate("/login"); }
          else onNav(item.id);
        }} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          background: "transparent", border: "none", cursor: "pointer",
          color: activeView === item.id ? "#58a6ff" : "var(--text-muted)",
          padding: "6px 12px", borderRadius: 8,
          transition: "color .15s",
          fontSize: 10, fontWeight: activeView === item.id ? 700 : 400,
        }}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function AppShell() {
  const [view,        setView]        = useState("search");
  const [projectId,   setProjectId]   = useState("");
  const [projectName, setProjectName] = useState("");

  const handleSelectProject = (id: string, name: string) => {
    setProjectId(id);
    setProjectName(name);
    setView("dashboard");
  };

  return (
    <div className="app-shell">
      <Sidebar onNav={setView} activeView={view} />

      <main className="app-main">
        {view === "search"   && <SearchPage />}
        {view === "projects" && <ProjectsPage onSelect={handleSelectProject} />}
        {view === "dashboard" && projectId
          ? <Dashboard projectId={projectId} projectName={projectName} />
          : view === "dashboard" && (
            <div style={{ padding: 40, color: "var(--text-muted)", textAlign: "center" }}>
              <p style={{ fontSize: 28, marginBottom: 12 }}>📊</p>
              <p>Selecciona un proyecto primero</p>
              <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => setView("projects")}>
                Ver proyectos
              </button>
            </div>
          )
        }
      </main>

      <BottomNav onNav={setView} activeView={view} />
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
