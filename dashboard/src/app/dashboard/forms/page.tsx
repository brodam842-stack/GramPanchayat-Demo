"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { fetchForms, createForm, deleteForm } from "@/lib/api";

interface BlankForm {
  id: string;
  name: string;
  pdf_url: string;
  required_documents: string;
  created_at: string;
}

export default function BlankFormsPage() {
  const [forms, setForms] = useState<BlankForm[]>([]);
  const [loading, setLoading] = useState(true);

  // Form submission state
  const [formName, setFormName] = useState("");
  const [requiredDocs, setRequiredDocs] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load configured blank forms
  const loadFormsList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchForms();
      setForms(res.forms || []);
    } catch (err) {
      console.error("Failed to load forms:", err);
      showToast("error", "Failed to load application forms.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFormsList();
  }, [loadFormsList]);

  // Handle toast timers
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const showToast = (type: "success" | "error" | "info", text: string) => {
    setToast({ type, text });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      showToast("error", "Only PDF files are supported for application forms.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    showToast("success", `Attached: ${file.name}`);
  };

  // Add a new application form
  const handleAddForm = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim() || !requiredDocs.trim()) {
      showToast("error", "Please provide a form name and a list of required documents.");
      return;
    }
    if (!selectedFile) {
      showToast("error", "Please attach a blank PDF application form.");
      return;
    }

    setSubmitting(true);
    showToast("info", "Uploading blank form PDF and saving configuration...");

    try {
      await createForm(formName, requiredDocs, selectedFile);
      showToast("success", "Application form successfully created and is now live on WhatsApp!");
      
      // Reset form
      setFormName("");
      setRequiredDocs("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      
      // Reload list
      loadFormsList();
    } catch (err: any) {
      console.error("Failed to add form:", err);
      showToast("error", err.message || "Failed to create application form.");
    } finally {
      setSubmitting(false);
    }
  };

  // Delete an existing form
  const handleDeleteForm = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This will remove the form from WhatsApp service.`)) {
      return;
    }

    showToast("info", `Deleting "${name}"...`);
    try {
      await deleteForm(id);
      showToast("success", "Application form deleted successfully.");
      loadFormsList();
    } catch (err: any) {
      console.error("Deletion failed:", err);
      showToast("error", err.message || "Failed to delete form.");
    }
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* ── Page Header ── */}
      <div className="page-header">
        <h1 className="page-title">📝 Blank Application Forms</h1>
        <p className="page-subtitle">Configure application forms that citizens can download directly through WhatsApp without logging in.</p>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>
              {toast.type === "success" ? "✅" : toast.type === "error" ? "❌" : "ℹ️"}
            </span>
            <span style={{ fontWeight: 500 }}>{toast.text}</span>
          </div>
        </div>
      )}

      {/* ── Main Two-Column Layout ── */}
      <div className="grid-3" style={{ gridTemplateColumns: "1.20fr 1.80fr", gap: "28px" }}>
        
        {/* Left Column: Create Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="card">
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "16px", color: "var(--text-primary)" }}>
              ➕ Configure New Form
            </h2>

            <form onSubmit={handleAddForm} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Form name */}
              <div className="form-group">
                <label className="form-label">Form Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Ration Card Application Form"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {/* Required Documents */}
              <div className="form-group">
                <label className="form-label">Required Documents</label>
                <textarea
                  className="form-input"
                  placeholder="List the required documents (e.g. Aadhaar Card, Photo, Birth Proof...)"
                  value={requiredDocs}
                  onChange={(e) => setRequiredDocs(e.target.value)}
                  disabled={submitting}
                  style={{ minHeight: "120px", resize: "vertical", lineHeight: 1.4 }}
                />
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  💡 These will be sent to the citizen's WhatsApp alongside the PDF.
                </span>
              </div>

              {/* PDF uploader */}
              <div className="form-group">
                <label className="form-label">Blank Form PDF</label>
                {!selectedFile ? (
                  <div 
                    onClick={() => !submitting && fileInputRef.current?.click()}
                    style={{
                      border: "2px dashed var(--border)",
                      borderRadius: "12px",
                      padding: "20px",
                      textAlign: "center",
                      background: "rgba(31,41,55,0.4)",
                      cursor: submitting ? "not-allowed" : "pointer",
                      transition: "border-color 0.2s"
                    }}
                    onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.borderColor = "var(--accent)"; }}
                    onMouseLeave={(e) => { if (!submitting) e.currentTarget.style.borderColor = "var(--border)"; }}
                  >
                    <div style={{ fontSize: "1.6rem" }}>📄</div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginTop: "6px" }}>Attach Blank Form PDF</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "2px" }}>Only PDFs are accepted (Max 15MB)</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", background: "#111827", borderRadius: "10px", border: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "1.4rem" }}>📄</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f9fafb", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                        {selectedFile.name}
                      </div>
                      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                    <button type="button" onClick={() => setSelectedFile(null)} disabled={submitting} className="btn btn-danger btn-sm" style={{ padding: "4px 8px", fontSize: "0.7rem" }}>
                      Remove
                    </button>
                  </div>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="application/pdf" 
                  style={{ display: "none" }} 
                />
              </div>

              {/* Submit */}
              <button type="submit" disabled={submitting} className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "8px" }}>
                {submitting ? "⏳ Creating Form..." : "🚀 Publish Application Form"}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: List Forms */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "400px" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "20px", color: "var(--text-primary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>📝 Active Forms on WhatsApp</span>
              <span className="badge badge-success" style={{ fontSize: "0.7rem" }}>
                {forms.length} {forms.length === 1 ? "Form" : "Forms"} Live
              </span>
            </h2>

            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", margin: "auto 0" }}>
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: "100px", borderRadius: "12px" }} />
                ))}
              </div>
            ) : forms.length === 0 ? (
              <div className="empty-state" style={{ margin: "auto 0" }}>
                <div className="empty-icon">📝</div>
                <h3>No Forms Configured</h3>
                <p style={{ fontSize: "0.85rem", maxWidth: "320px", margin: "0 auto" }}>
                  Upload blank forms like Ration Card application, Income certificates, etc. Citizens can retrieve them instantly on WhatsApp.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {forms.map(form => (
                  <div 
                    key={form.id} 
                    style={{
                      padding: "16px", background: "#111827", borderRadius: "12px", border: "1px solid var(--border)",
                      display: "flex", justifyContent: "space-between", gap: "16px", transition: "border-color 0.2s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                  >
                    {/* Form info */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                      <div>
                        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f9fafb" }}>{form.name}</div>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                          Added on: {new Date(form.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      
                      {/* Required documents section */}
                      <div style={{ background: "var(--bg-secondary)", borderRadius: "8px", padding: "10px", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--accent-light)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "4px" }}>
                          📂 Required Documents to submit
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", whiteSpace: "pre-line", lineHeight: 1.4 }}>
                          {form.required_documents}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", justifyContent: "space-between", alignItems: "flex-end" }}>
                      <a href={form.pdf_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ border: "1px solid var(--border-light)", textDecoration: "none", fontSize: "0.75rem", padding: "6px 10px" }}>
                        📥 View PDF
                      </a>
                      <button 
                        onClick={() => handleDeleteForm(form.id, form.name)}
                        className="btn btn-danger btn-sm"
                        style={{ fontSize: "0.75rem", padding: "6px 10px" }}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
