import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (email: string, password: string) =>
  api.post<{ access_token: string }>("/auth/login", new URLSearchParams({ username: email, password }), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

export const register = (email: string, password: string) =>
  api.post("/auth/register", { email, password });

// Projects
export const getProjects = () => api.get("/projects").then((r) => r.data);
export const createProject = (data: { name: string; keywords: string[]; sources: string[]; language: string }) =>
  api.post("/projects", data).then((r) => r.data);
export const deleteProject = (id: string) => api.delete(`/projects/${id}`);

// Mentions
export const getMentions = (
  projectId: string,
  params: { platform?: string; sentiment?: string; q?: string; limit?: number; offset?: number }
) => api.get(`/projects/${projectId}/mentions`, { params }).then((r) => r.data);

// Metrics
export const getTimeseries = (projectId: string, from: string, to: string, granularity = "hour") =>
  api.get(`/projects/${projectId}/metrics/timeseries`, { params: { from_date: from, to_date: to, granularity } }).then((r) => r.data);

export const getMetricsSummary = (projectId: string, from: string, to: string) =>
  api.get(`/projects/${projectId}/metrics/summary`, { params: { from_date: from, to_date: to } }).then((r) => r.data);

export const getTopCreators = (projectId: string) =>
  api.get(`/projects/${projectId}/metrics/creators`).then((r) => r.data);

// Alerts
export const getAlerts = (projectId: string) => api.get(`/projects/${projectId}/alerts`).then((r) => r.data);
export const createAlert = (projectId: string, data: object) =>
  api.post(`/projects/${projectId}/alerts`, data).then((r) => r.data);
export const deleteAlert = (projectId: string, ruleId: string) =>
  api.delete(`/projects/${projectId}/alerts/${ruleId}`);
