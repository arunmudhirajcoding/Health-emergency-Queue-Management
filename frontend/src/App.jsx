import { Activity, Clock, HeartPulse, RefreshCcw, ShieldAlert, Stethoscope, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const API_URL = "http://127.0.0.1:8000/api";

const initialForm = {
  name: "",
  age: "",
  severity: "moderate",
  symptoms: "",
};

const severityOptions = [
  { value: "critical", label: "Critical", hint: "Immediate attention" },
  { value: "serious", label: "Serious", hint: "High risk" },
  { value: "moderate", label: "Moderate", hint: "Needs care soon" },
  { value: "stable", label: "Stable", hint: "Can safely wait" },
];

function App() {
  const [form, setForm] = useState(initialForm);
  const [queueState, setQueueState] = useState({
    queue: [],
    treated: [],
    total_waiting: 0,
    total_treated: 0,
    average_wait_minutes: 0,
    updated_at: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const nextPatient = queueState.queue[0];

  const lastUpdated = useMemo(() => {
    if (!queueState.updated_at) return "Waiting for sync";
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(queueState.updated_at));
  }, [queueState.updated_at]);

  async function fetchQueue(showLoading = false) {
    if (showLoading) setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/queue`);
      if (!response.ok) throw new Error("Unable to load queue");
      const data = await response.json();
      setQueueState(data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchQueue(true);
    const timer = window.setInterval(() => fetchQueue(), 2500);
    return () => window.clearInterval(timer);
  }, []);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitPatient(event) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch(`${API_URL}/patients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          age: Number(form.age),
        }),
      });
      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail.detail?.[0]?.msg || detail.detail || "Could not add patient");
      }
      const data = await response.json();
      setQueueState(data);
      setForm(initialForm);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function treatNext() {
    try {
      const response = await fetch(`${API_URL}/queue/next`, { method: "POST" });
      if (!response.ok) throw new Error("No patient is waiting");
      setQueueState(await response.json());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function removePatient(id) {
    try {
      const response = await fetch(`${API_URL}/queue/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove patient");
      setQueueState(await response.json());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="app-shell">
      {/* title bar */}
      <section className="topbar">
        <div>
          <p className="eyebrow">Emergency Department</p>
          <h1>Hospital Emergency Queue Management</h1>
        </div>
        <div className="sync-pill" title="Queue updates automatically every 2.5 seconds">
          <RefreshCcw size={18} aria-hidden="true" />
          <span>{lastUpdated}</span>
        </div>
      </section>

      {error && <div className="alert">{error}</div>}
      {/* analytics */}
      <section className="stats-grid" aria-label="Queue summary">
        <StatCard icon={ShieldAlert} label="Waiting" value={queueState.total_waiting} />
        <StatCard icon={Stethoscope} label="Treated" value={queueState.total_treated} />
        <StatCard icon={Clock} label="Avg Wait" value={`${queueState.average_wait_minutes} min`} />
        <StatCard icon={HeartPulse} label="Next" value={nextPatient?.priority_label || "None"} />
      </section>

      <section className="workspace">
        {/* Form */}
        <form className="patient-form" onSubmit={submitPatient}>
          <div className="form-title">
            <UserPlus size={22} aria-hidden="true" />
            <h2>Patient Entry</h2>
          </div>

          <label>
            Patient Name
            <input name="name" value={form.name} onChange={updateForm} minLength="2" required placeholder="Aarav Sharma" />
          </label>

          <label>
            Age
            <input name="age" value={form.age} onChange={updateForm} type="number" min="0" max="120" required placeholder="42" />
          </label>

          <div className="severity-group">
            <span>Severity</span>
            <div className="severity-options">
              {severityOptions.map((option) => (
                <label className={`severity-option ${form.severity === option.value ? "selected" : ""}`} key={option.value}>
                  <input type="radio" name="severity" value={option.value} checked={form.severity === option.value} onChange={updateForm} />
                  <span className={`dot ${option.value}`} />
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </label>
              ))}
            </div>
          </div>

          <label>
            Symptoms
            <textarea name="symptoms" value={form.symptoms} onChange={updateForm} minLength="3" required placeholder="Chest pain, dizziness..." />
          </label>

          <button className="primary-action" disabled={isSaving} type="submit">
            <UserPlus size={18} aria-hidden="true" />
            {isSaving ? "Adding..." : "Add to Queue"}
          </button>
        </form>

      {/* Dashboard */}
        <section className="dashboard" aria-label="Queue dashboard">

          {/* header */}
          <div className="dashboard-header">
            <div>
              <p className="eyebrow">Priority Queue</p>
              <h2>Live Emergency Dashboard</h2>
            </div>
            <button className="treat-button" onClick={treatNext} disabled={!queueState.queue.length}>
              <Activity size={18} aria-hidden="true" />
              Treat Next
            </button>
          </div>

              {/* patient list */}
          {isLoading ? (
            <div className="empty-state">Loading queue...</div>
          ) : queueState.queue.length ? (
            <div className="queue-list">
              {queueState.queue.map((patient) => (
                <article className={`queue-card ${patient.severity}`} key={patient.id}>
                  <div className="queue-position">{patient.position}</div>
                  <div className="patient-info">
                    <div className="patient-line">
                      <h3>{patient.name}</h3>
                      <span className={`priority-badge ${patient.severity}`}>{patient.priority_label}</span>
                    </div>
                    <p>{patient.symptoms}</p>
                    <div className="patient-meta">
                      <span>Age {patient.age}</span>
                      <span>{patient.estimated_wait_minutes} min wait</span>
                      <span>Rank {patient.priority_rank}</span>
                    </div>
                  </div>
                  <button className="icon-button" onClick={() => removePatient(patient.id)} aria-label={`Remove ${patient.name}`}>
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">No patients are currently waiting.</div>
          )}
        </section>
      </section>

          {/* treated list */}
      <section className="treated-strip">
        <h2>Recently Treated</h2>
        {queueState.treated.length ? (
          <div className="treated-list">
            {queueState.treated.map((patient) => (
              <span className={`treated-chip ${patient.severity}`} key={patient.id}>
                {patient.name}
              </span>
            ))}
          </div>
        ) : (
          <p>No completed cases yet.</p>
        )}
      </section>
    </main>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <article className="stat-card">
      <Icon size={24} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

export default App;
