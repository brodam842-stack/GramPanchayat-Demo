"use client";
import { useEffect, useState, useCallback } from "react";
import { fetchTransactions } from "@/lib/api";

interface Txn {
  id: string; whatsapp_number: string; document_requested: string;
  request_timestamp: string; delivery_status: string; failure_reason: string;
  citizens?: { full_name: string; mobile_number: string; village: string };
}

export default function AuditPage() {
  const [txns,    setTxns]    = useState<Txn[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [status,  setStatus]  = useState("");
  const [from,    setFrom]    = useState("");
  const [to,      setTo]      = useState("");
  const [loading, setLoading] = useState(true);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTransactions(page, LIMIT, status, from, to);
      setTxns(data.transactions || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [page, status, from, to]);

  useEffect(() => { load(); }, [load]);

  function statusBadge(s: string) {
    const map: Record<string, string> = { success: "badge-success", failed: "badge-danger", pending: "badge-warning" };
    return <span className={`badge ${map[s] || "badge-gray"}`}>{s}</span>;
  }

  function renderDocCell(doc: string) {
    if (!doc) return <span>—</span>;
    const match = doc.match(/^\[([^\]]+)\](.*)$/);
    if (!match) return <span style={{ color: "#d1d5db" }}>{doc}</span>;

    const category = match[1];
    const rest = match[2].trim();

    // Map categories to dynamic CSS styles
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      "Tax Alert": { bg: "rgba(249, 115, 22, 0.12)", text: "#ffedd5", border: "rgba(249, 115, 22, 0.3)" },
      "Tax Circular": { bg: "rgba(234, 179, 8, 0.12)", text: "#fef9c3", border: "rgba(234, 179, 8, 0.3)" },
      "Broadcast": { bg: "rgba(59, 130, 246, 0.12)", text: "#dbeafe", border: "rgba(59, 130, 246, 0.3)" },
      "Doc Retrieval": { bg: "rgba(16, 185, 129, 0.12)", text: "#d1fae5", border: "rgba(16, 185, 129, 0.3)" },
      "Form Download": { bg: "rgba(139, 92, 246, 0.12)", text: "#ede9fe", border: "rgba(139, 92, 246, 0.3)" },
      "Receipt Delivery": { bg: "rgba(20, 184, 166, 0.12)", text: "#ccfbf1", border: "rgba(20, 184, 166, 0.3)" },
    };

    const scheme = colors[category] || { bg: "rgba(107, 114, 128, 0.12)", text: "#f3f4f6", border: "rgba(107, 114, 128, 0.3)" };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 8px",
          borderRadius: "12px",
          fontSize: "0.68rem",
          fontWeight: 600,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          backgroundColor: scheme.bg,
          color: scheme.text,
          border: `1px solid ${scheme.border}`
        }}>
          {category}
        </span>
        {rest && <span style={{ color: "#d1d5db", fontSize: "0.82rem", display: "block" }}>{rest}</span>}
      </div>
    );
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">🔍 Audit Logs</h1>
          <p className="page-subtitle">Complete transaction history — {total} records</p>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm">🔄 Refresh</button>
      </div>

      {/* ── Filters ── */}
      <div className="card card-sm" style={{ marginBottom: "20px", display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="form-group" style={{ flex: 1, minWidth: "140px" }}>
          <label className="form-label">Status</label>
          <select className="form-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: "160px" }}>
          <label className="form-label">From Date</label>
          <input type="date" className="form-input" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: "160px" }}>
          <label className="form-label">To Date</label>
          <input type="date" className="form-input" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => { setStatus(""); setFrom(""); setTo(""); setPage(1); }}>
          Clear Filters
        </button>
      </div>

      {/* ── Table ── */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Citizen</th>
                <th>WhatsApp</th>
                <th>Document</th>
                <th>Timestamp</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton" style={{ height: "18px" }} /></td>)}</tr>
                ))
              ) : txns.length ? txns.map(t => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: "#f9fafb" }}>{t.citizens?.full_name || "—"}</div>
                    <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>{t.citizens?.village || ""}</div>
                  </td>
                  <td><span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#9ca3af" }}>{t.whatsapp_number.replace("whatsapp:", "")}</span></td>
                  <td>{renderDocCell(t.document_requested)}</td>
                  <td>
                    <div style={{ fontSize: "0.8rem", color: "#d1d5db" }}>
                      {new Date(t.request_timestamp).toLocaleDateString("en-IN")}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>
                      {new Date(t.request_timestamp).toLocaleTimeString("en-IN")}
                    </div>
                  </td>
                  <td>{statusBadge(t.delivery_status)}</td>
                  <td>
                    {t.failure_reason
                      ? <span title={t.failure_reason} style={{ fontSize: "0.75rem", color: "#f87171", cursor: "help" }}>
                          ⚠️ {t.failure_reason.slice(0, 30)}…
                        </span>
                      : <span style={{ color: "#4b5563", fontSize: "0.75rem" }}>—</span>
                    }
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-icon">📋</div>
                      <h3>No transactions found</h3>
                      <p>Transactions will appear as citizens use the WhatsApp bot</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pagination" style={{ padding: "16px" }}>
            <button className="page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            {[...Array(Math.min(totalPages, 7))].map((_, i) => (
              <button key={i + 1} className={`page-btn ${page === i + 1 ? "active" : ""}`} onClick={() => setPage(i + 1)}>{i + 1}</button>
            ))}
            <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}
