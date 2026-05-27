"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { 
  fetchTaxRecords, 
  createTaxRecord, 
  updateTaxRecord, 
  importTaxExcel, 
  circulateTaxTemplate,
  triggerMockTaxWebhook,
  deleteTaxRecord,
  deleteAllTaxRecords,
  notifyTaxRecord
} from "@/lib/api";

interface TaxRecord {
  id: string;
  property_id: string;
  owner_name: string;
  due_amount: number;
  mobile_number: string;
  payment_status: "pending" | "paid";
  payment_link?: string;
  receipt_pdf_url?: string;
  created_at: string;
}

export default function PropertyTaxPage() {
  const [records, setRecords] = useState<TaxRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortSelection, setSortSelection] = useState("default");
  
  // Composer states
  const [templateText, setTemplateText] = useState(
    "🙏 *Gram Panchayat Property Tax Alert*\n\n" +
    "Dear {owner_name},\n" +
    "Property tax is outstanding for Property ID: *{property_id}*.\n\n" +
    "💰 *Outstanding Due Amount:* ₹{due_amount}\n\n" +
    "Please complete your payment online using the secure link below:\n" +
    "🔗 {payment_link}\n\n" +
    "_Note: A digital receipt will be sent instantly on this chat upon payment confirmation._"
  );
  
  const [selectedRecordForPreview, setSelectedRecordForPreview] = useState<TaxRecord | null>(null);

  // Edit/Add modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingId, setEditingId] = useState("");
  const [propId, setPropId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [dueAmount, setDueAmount] = useState("");
  const [mobileNum, setMobileNum] = useState("");
  const [payStatus, setPayStatus] = useState<"pending" | "paid">("pending");

  // Loading/Operation states
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCirculating, setIsCirculating] = useState(false);
  const [circulateProgress, setCirculateProgress] = useState({ current: 0, total: 0 });
  const [circulateReport, setCirculateReport] = useState<string | null>(null);

  // Global aggregate stats
  const [stats, setStats] = useState({
    totalPendingAmount: 0,
    totalPaidAmount: 0,
    totalPendingCount: 0,
    totalPaidCount: 0
  });

  // Notification Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Individual notification loading state
  const [isNotifyingId, setIsNotifyingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    let currentSortBy = "created_at";
    let currentSortOrder = "desc";

    if (sortSelection === "prop_asc") {
      currentSortBy = "property_id";
      currentSortOrder = "asc";
    } else if (sortSelection === "prop_desc") {
      currentSortBy = "property_id";
      currentSortOrder = "desc";
    }

    try {
      const data = await fetchTaxRecords(page, 10, search, statusFilter, currentSortBy, currentSortOrder);
      setRecords(data.records);
      setTotalRecords(data.total);
      if (data.stats) {
        setStats(data.stats);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to load tax records", "error");
    } finally {
      setIsLoading(false);
    }
  }, [page, search, statusFilter, sortSelection]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Set default preview record once records are loaded
  useEffect(() => {
    if (records.length > 0 && !selectedRecordForPreview) {
      setSelectedRecordForPreview(records[0]);
    }
  }, [records, selectedRecordForPreview]);

  function showToast(message: string, type: "success" | "error" | "info") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  // Handle Excel sheet import
  async function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    showToast("Parsing and importing Excel records... Please wait", "info");
    try {
      const res = await importTaxExcel(file);
      showToast(res.message || "Tax records imported successfully!", "success");
      setPage(1);
      loadRecords();
    } catch (err: any) {
      showToast(err.message || "Failed to import tax sheet", "error");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Add/Edit manual entry handlers
  function openAddModal() {
    setModalMode("add");
    setEditingId("");
    setPropId("");
    setOwnerName("");
    setDueAmount("");
    setMobileNum("");
    setPayStatus("pending");
    setIsModalOpen(true);
  }

  function openEditModal(record: TaxRecord) {
    setModalMode("edit");
    setEditingId(record.id);
    setPropId(record.property_id);
    setOwnerName(record.owner_name);
    setDueAmount(String(record.due_amount));
    setMobileNum(record.mobile_number);
    setPayStatus(record.payment_status);
    setIsModalOpen(true);
  }

  async function handleSaveRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!propId || !ownerName || !dueAmount || !mobileNum) {
      showToast("Please fill all required fields", "error");
      return;
    }

    try {
      if (modalMode === "add") {
        await createTaxRecord(propId, ownerName, parseFloat(dueAmount), mobileNum);
        showToast("Tax record added successfully!", "success");
      } else {
        await updateTaxRecord(editingId, {
          propertyId: propId,
          ownerName,
          dueAmount: parseFloat(dueAmount),
          mobileNumber: mobileNum,
          paymentStatus: payStatus
        });
        showToast("Tax record updated successfully!", "success");
      }
      setIsModalOpen(false);
      loadRecords();
    } catch (err: any) {
      showToast(err.message || "Failed to save record", "error");
    }
  }

  // Inject tag variables into template at current cursor position
  function injectTag(tag: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);

    const newText = before + tag + after;
    setTemplateText(newText);

    // Reset cursor focus
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  }

  // Circular message alert alerts bulk dispatch loop
  async function handleCirculate() {
    if (!templateText) {
      showToast("Template message cannot be empty", "error");
      return;
    }

    const confirmCirculate = window.confirm("Are you sure you want to generate secure payment links and dispatch WhatsApp alerts to ALL pending property holders?");
    if (!confirmCirculate) return;

    setIsCirculating(true);
    setCirculateReport(null);
    setCirculateProgress({ current: 0, total: totalRecords });
    
    try {
      const res = await circulateTaxTemplate(templateText);
      showToast("Tax message alerts circulation complete!", "success");
      setCirculateReport(res.message);
      loadRecords();
    } catch (err: any) {
      showToast(err.message || "Failed to circulate alerts", "error");
    } finally {
      setIsCirculating(false);
    }
  }

  // Send individual WhatsApp tax due alert
  async function handleSendIndividualAlert(record: TaxRecord) {
    if (!templateText) {
      showToast("Template message cannot be empty", "error");
      return;
    }

    const confirmNotify = window.confirm(`Send customized property tax WhatsApp alert to ${record.owner_name} (+91 ${record.mobile_number})?`);
    if (!confirmNotify) return;

    setIsNotifyingId(record.id);
    showToast("Generating link & delivering WhatsApp alert...", "info");

    try {
      const res = await notifyTaxRecord(record.id, templateText);
      showToast(res.message || "Tax alert sent successfully!", "success");
      loadRecords();
    } catch (err: any) {
      showToast(err.message || "Failed to deliver tax alert", "error");
    } finally {
      setIsNotifyingId(null);
    }
  }

  // Mock trigger Razorpay webhook payment capture in development mode
  async function handleMockWebhookTrigger(record: TaxRecord) {
    const confirmTrigger = window.confirm(`Simulate payment confirmation for ${record.owner_name} (Property ID: ${record.property_id})? This will invoke the Razorpay webhook locally to update the status to paid and WhatsApp them the PDF receipt.`);
    if (!confirmTrigger) return;

    showToast("Triggering mock webhook payment captures...", "info");
    try {
      const res = await triggerMockTaxWebhook(record.property_id);
      showToast(res.message || "Mock payment captured! Check WhatsApp for the PDF bill.", "success");
      loadRecords();
    } catch (err: any) {
      showToast(err.message || "Mock webhook trigger failed", "error");
    }
  }

  async function handleDeleteRecordClick(record: TaxRecord) {
    if (!window.confirm(`⚠️ Are you absolutely sure you want to permanently delete the tax record for Property ID: "${record.property_id}"?\n\nOwner: ${record.owner_name}\nDue: ₹${record.due_amount}`)) {
      return;
    }

    setIsLoading(true);
    try {
      await deleteTaxRecord(record.id);
      showToast(`Tax record for Property ID "${record.property_id}" deleted successfully.`, "success");
      
      if (selectedRecordForPreview?.id === record.id) {
        setSelectedRecordForPreview(null);
      }
      
      loadRecords();
    } catch (err: any) {
      showToast(err.message || "Failed to delete tax record", "error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteAllClick() {
    if (!window.confirm("⚠️ WARNING: This will permanently delete ALL property tax records from the database. This action CANNOT be undone!\n\nAre you absolutely sure you want to clear all records?")) {
      return;
    }
    
    if (!window.confirm("FINAL CONFIRMATION REQUIRED: Click OK to delete all tax data permanently.")) {
      return;
    }

    setIsLoading(true);
    try {
      const res = await deleteAllTaxRecords();
      showToast(res.message || "All property tax records have been successfully cleared.", "success");
      setSelectedRecordForPreview(null);
      setPage(1);
      loadRecords();
    } catch (err: any) {
      showToast(err.message || "Failed to delete all tax records", "error");
    } finally {
      setIsLoading(false);
    }
  }

  // Dynamic Whatsapp preview rendering
  function renderWhatsAppPreview() {
    const defaultPreview: TaxRecord = {
      id: "preview-id",
      property_id: "1885",
      owner_name: "Ramesh Kumar Verma",
      due_amount: 1885.00,
      mobile_number: "9876543210",
      payment_status: "pending",
      payment_link: "https://rzp.io/i/mock_tax_preview",
      created_at: new Date().toISOString()
    };

    const record = selectedRecordForPreview || defaultPreview;
    
    return templateText
      .replace(/{owner_name}/gi, `*${record.owner_name}*`)
      .replace(/{property_id}/gi, `*${record.property_id}*`)
      .replace(/{due_amount}/gi, `*${parseFloat(String(record.due_amount)).toFixed(2)}*`)
      .replace(/{payment_link}/gi, record.payment_link || "https://rzp.io/i/tax_payment_url");
  }

  // Stats aggregate helpers
  const statsPending = records.filter(r => r.payment_status === "pending").length;
  const statsPaid = records.filter(r => r.payment_status === "paid").length;

  return (
    <div className="container-fluid" style={{ padding: "24px" }}>
      {/* ── Notification Toast ── */}
      {toast && (
        <div className={`toast toast-${toast.type}`} style={{
          position: "fixed", top: "24px", right: "24px", zIndex: 1000,
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)"
        }}>
          {toast.message}
        </div>
      )}

      {/* ── Header ── */}
      <div className="row align-items-center mb-4">
        <div className="col">
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0, color: "#f9fafb" }}>
            💳 Property Tax Dues & Billing
          </h1>
          <p style={{ margin: "4px 0 0 0", fontSize: "0.875rem", color: "#9ca3af" }}>
            Import property tax sheets, edit records, generate secure Razorpay checkout links, and circulate automated alerts.
          </p>
        </div>
        <div className="col-auto">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".xlsx, .xls" 
            style={{ display: "none" }} 
          />
          <button 
            onClick={handleImportClick} 
            disabled={isImporting} 
            className="btn btn-secondary mr-2"
          >
            📊 {isImporting ? "Importing Excel..." : "Import Tax Excel"}
          </button>
          <button onClick={openAddModal} className="btn btn-primary mr-2" style={{ marginRight: "8px" }}>
            ➕ Add Tax Entry
          </button>
          <button 
            onClick={handleDeleteAllClick} 
            disabled={totalRecords === 0 || isLoading} 
            className="btn btn-danger"
          >
            🗑️ Delete All Records
          </button>
        </div>
      </div>

      {/* ── Metrics Row ── */}
      <div className="row mb-4">
        <div className="col-md-3">
          <div className="card card-dark" style={{ padding: "20px" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>
              Pending Collections
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: "8px", color: "#f3f4f6" }}>
              {isLoading ? "..." : stats.totalPendingAmount.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#f59e0b", marginTop: "4px" }}>
              Total outstanding tax dues in system
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card card-dark" style={{ padding: "20px" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>
              Dues Collected
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: "8px", color: "#10b981" }}>
              {isLoading ? "..." : stats.totalPaidAmount.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#10b981", marginTop: "4px" }}>
              Total online payments confirmed
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card card-dark" style={{ padding: "20px" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>
              Total Active Dues
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: "8px", color: "#60a5fa" }}>
              {totalRecords}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "4px" }}>
              Imported property accounts
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card card-dark" style={{ padding: "20px" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af" }}>
              Collection Rate
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: "8px", color: "#a855f7" }}>
              {totalRecords > 0 ? `${Math.round((stats.totalPaidCount / totalRecords) * 100)}%` : "0%"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#c084fc", marginTop: "4px" }}>
              Percentage of properties paid
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Working Grid ── */}
      <div className="row">
        {/* Left Panel: Table Lists */}
        <div className="col-lg-7 mb-4">
          <div className="card card-dark h-100" style={{ padding: "24px" }}>
            <div className="row align-items-center mb-3">
              <div className="col-md-3">
                <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0, color: "#f3f4f6" }}>
                  Property Tax
                </h3>
              </div>
              <div className="col-md-3">
                <input 
                  type="text" 
                  placeholder="🔍 Search..." 
                  value={search} 
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="form-input"
                  style={{ fontSize: "0.85rem", height: "36px" }}
                />
              </div>
              <div className="col-md-3">
                <select 
                  value={statusFilter} 
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="form-select text-capitalize"
                  style={{ fontSize: "0.85rem", height: "36px" }}
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <div className="col-md-3">
                <select 
                  value={sortSelection} 
                  onChange={(e) => { setSortSelection(e.target.value); setPage(1); }}
                  className="form-select"
                  style={{ fontSize: "0.85rem", height: "36px" }}
                >
                  <option value="default">Sort: Newest First</option>
                  <option value="prop_asc">Property ID: Asc ↗</option>
                  <option value="prop_desc">Property ID: Desc ↘</option>
                </select>
              </div>
            </div>

            {/* Table Container */}
            <div className="table-responsive" style={{ flexGrow: 1, minHeight: "350px" }}>
              {isLoading ? (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "300px" }}>
                  <div className="spinner"></div>
                </div>
              ) : records.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "300px", color: "#9ca3af" }}>
                  <span style={{ fontSize: "2rem" }}>📊</span>
                  <div style={{ marginTop: "12px", fontSize: "0.9rem" }}>No Property Tax records found.</div>
                  <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>Try importing an Excel report or adding a manual entry.</div>
                </div>
              ) : (
                <table className="table" style={{ fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th>Property ID</th>
                      <th>Owner Name</th>
                      <th>Mobile No</th>
                      <th>Due Amount</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(record => (
                      <tr 
                        key={record.id} 
                        className={selectedRecordForPreview?.id === record.id ? "active-row-preview" : ""}
                        onClick={() => setSelectedRecordForPreview(record)}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ fontWeight: 600, color: "#e5e7eb" }}>{record.property_id}</td>
                        <td style={{ maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{record.owner_name}</span>
                            {record.payment_status === "pending" && (
                              isNotifyingId === record.id ? (
                                <span style={{
                                  width: "12px",
                                  height: "12px",
                                  border: "2px solid #22c55e",
                                  borderTopColor: "transparent",
                                  borderRadius: "50%",
                                  display: "inline-block",
                                  animation: "spin 1s linear infinite"
                                }} />
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendIndividualAlert(record);
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    cursor: "pointer",
                                    fontSize: "1rem",
                                    lineHeight: 1,
                                    display: "inline-flex",
                                    alignItems: "center"
                                  }}
                                  title="Send individual WhatsApp tax alert"
                                >
                                  💬
                                </button>
                              )
                            )}
                          </div>
                        </td>
                        <td>+91 {record.mobile_number}</td>
                        <td style={{ fontWeight: 600 }}>₹{parseFloat(String(record.due_amount)).toFixed(2)}</td>
                        <td>
                          <span className={`badge ${record.payment_status === "paid" ? "badge-success" : "badge-warning"}`}>
                            {record.payment_status}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {record.payment_status === "pending" && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleMockWebhookTrigger(record); }} 
                              className="btn btn-secondary btn-sm mr-1" 
                              title="Trigger Mock Webhook Payment Confirmation"
                              style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                            >
                              💵 Mock Pay
                            </button>
                          )}
                          {record.payment_status === "paid" && record.receipt_pdf_url && (
                            <a 
                              href={record.receipt_pdf_url} 
                              target="_blank" 
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="btn btn-secondary btn-sm mr-1"
                              style={{ fontSize: "0.75rem", padding: "4px 8px", textDecoration: "none" }}
                            >
                              📄 Bill
                            </a>
                          )}
                          <button 
                            onClick={(e) => { e.stopPropagation(); openEditModal(record); }} 
                            className="btn btn-primary btn-sm mr-1"
                            style={{ fontSize: "0.75rem", padding: "4px 8px", marginRight: "4px" }}
                          >
                            ✏️ Edit
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDeleteRecordClick(record); }} 
                            className="btn btn-danger btn-sm"
                            style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                            title="Delete Record"
                          >
                            🗑️ Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination footer */}
            {totalRecords > 10 && (
              <div className="row align-items-center mt-3" style={{ borderTop: "1px solid #374151", paddingTop: "12px" }}>
                <div className="col">
                  <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                    Showing {(page - 1) * 10 + 1} - {Math.min(page * 10, totalRecords)} of {totalRecords} records
                  </span>
                </div>
                <div className="col-auto">
                  <button 
                    disabled={page === 1} 
                    onClick={() => setPage(page - 1)} 
                    className="btn btn-secondary btn-sm mr-2"
                  >
                    Previous
                  </button>
                  <button 
                    disabled={page * 10 >= totalRecords} 
                    onClick={() => setPage(page + 1)} 
                    className="btn btn-secondary btn-sm"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Template Composer & WhatsApp Smartphone Simulator */}
        <div className="col-lg-5 mb-4">
          <div className="card card-dark" style={{ padding: "24px" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "16px", color: "#f3f4f6" }}>
              Template Composer & Preview
            </h3>

            {/* Template input box */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#9ca3af", display: "block", marginBottom: "6px" }}>
                Customized Message Template
              </label>
              <textarea 
                ref={textareaRef}
                value={templateText} 
                onChange={(e) => setTemplateText(e.target.value)} 
                className="form-input"
                rows={5}
                style={{ fontSize: "0.85rem", resize: "vertical", fontFamily: "monospace", backgroundColor: "#0f172a" }}
              />
            </div>

            {/* Token badging pills */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "8px", fontWeight: 600 }}>
                Click variable tags to insert at cursor:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                <button onClick={() => injectTag("{owner_name}")} className="btn btn-secondary btn-sm" style={{ fontSize: "0.7rem", padding: "4px 8px" }}>
                  👤 owner_name
                </button>
                <button onClick={() => injectTag("{property_id}")} className="btn btn-secondary btn-sm" style={{ fontSize: "0.7rem", padding: "4px 8px" }}>
                  🏠 property_id
                </button>
                <button onClick={() => injectTag("{due_amount}")} className="btn btn-secondary btn-sm" style={{ fontSize: "0.7rem", padding: "4px 8px" }}>
                  💰 due_amount
                </button>
                <button onClick={() => injectTag("{payment_link}")} className="btn btn-secondary btn-sm" style={{ fontSize: "0.7rem", padding: "4px 8px" }}>
                  🔗 payment_link
                </button>
              </div>
            </div>

            {/* WhatsApp Phone Mock Simulator */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#9ca3af", display: "block", marginBottom: "8px" }}>
                WhatsApp Citizen Mock Preview
              </div>
              <div className="phone-container" style={{ margin: "0 auto", maxWidth: "100%" }}>
                <div className="phone-screen" style={{ height: "260px" }}>
                  <div className="chat-area" style={{ height: "100%", padding: "16px" }}>
                    <div className="chat-bubble-received" style={{ maxWidth: "85%", fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>
                      {renderWhatsAppPreview()}
                      <div style={{ fontSize: "0.65rem", textAlign: "right", marginTop: "4px", color: "#6b7280" }}>
                        10:44 PM
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Dispatch Action */}
            <button 
              onClick={handleCirculate} 
              disabled={isCirculating || records.filter(r => r.payment_status === "pending").length === 0} 
              className="btn btn-primary" 
              style={{ width: "100%", height: "46px", fontWeight: 600, fontSize: "0.95rem" }}
            >
              📢 {isCirculating ? "Circulating Alerts..." : "Circulate Payment Alerts"}
            </button>

            {/* Circulation logs / summaries */}
            {circulateReport && (
              <div style={{ marginTop: "16px", padding: "12px", borderRadius: "6px", backgroundColor: "#1e293b", border: "1px solid #334155", fontSize: "0.8rem", color: "#a7f3d0" }}>
                ✓ {circulateReport}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Dues Editor Modal ── */}
      {isModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "center"
        }}>
          <div className="card card-dark" style={{ width: "450px", padding: "24px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "16px", color: "#f3f4f6" }}>
              {modalMode === "add" ? "➕ Add Property Tax Entry" : "✏️ Edit Property Tax Entry"}
            </h3>
            <form onSubmit={handleSaveRecord}>
              <div className="mb-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>Property ID (Milkat No) *</label>
                <input 
                  type="text" 
                  value={propId} 
                  onChange={(e) => setPropId(e.target.value)} 
                  className="form-input" 
                  placeholder="e.g. 1885"
                  required
                />
              </div>
              <div className="mb-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>Owner Registered Name *</label>
                <input 
                  type="text" 
                  value={ownerName} 
                  onChange={(e) => setOwnerName(e.target.value)} 
                  className="form-input" 
                  placeholder="e.g. Ramesh Kumar Verma"
                  required
                />
              </div>
              <div className="mb-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>Outstanding Tax Due (₹) *</label>
                <input 
                  type="number" 
                  value={dueAmount} 
                  onChange={(e) => setDueAmount(e.target.value)} 
                  className="form-input" 
                  placeholder="e.g. 1885.00"
                  step="0.01"
                  required
                />
              </div>
              <div className="mb-3">
                <label className="form-label" style={{ fontSize: "0.8rem" }}>Owner WhatsApp Mobile *</label>
                <input 
                  type="text" 
                  value={mobileNum} 
                  onChange={(e) => setMobileNum(e.target.value)} 
                  className="form-input" 
                  placeholder="e.g. 9876543210"
                  required
                />
              </div>
              {modalMode === "edit" && (
                <div className="mb-3">
                  <label className="form-label" style={{ fontSize: "0.8rem" }}>Payment Status</label>
                  <select 
                    value={payStatus} 
                    onChange={(e) => setPayStatus(e.target.value as "pending" | "paid")}
                    className="form-select text-capitalize"
                  >
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" }}>
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
