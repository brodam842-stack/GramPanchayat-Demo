const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000").replace(/\/+$/, "");

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("gp_token") || "";
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem("gp_token");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Overview ─────────────────────────────────────────────────────────────────
export async function fetchOverview() {
  return apiFetch("/api/analytics/overview");
}

export async function fetchDailyTrend(days = 30) {
  return apiFetch(`/api/analytics/daily-trend?days=${days}`);
}

export async function fetchPopularDocs() {
  return apiFetch("/api/analytics/popular-documents");
}

// ── Citizens ─────────────────────────────────────────────────────────────────
export async function fetchCitizens(page = 1, limit = 20, search = "") {
  return apiFetch(`/api/citizens?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`);
}

export async function fetchCitizen(id: string) {
  return apiFetch(`/api/citizens/${id}`);
}

export async function createCitizen(data: Record<string, string>) {
  return apiFetch("/api/citizens", { method: "POST", body: JSON.stringify(data) });
}

export async function updateCitizen(id: string, data: Record<string, unknown>) {
  return apiFetch(`/api/citizens/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export async function deleteCitizen(id: string) {
  return apiFetch(`/api/citizens/${id}`, { method: "DELETE" });
}

export async function uploadDocument(citizenId: string, file: File) {
  const token = getToken();
  const formData = new FormData();
  formData.append("citizenId", citizenId);
  formData.append("file", file);

  const res = await fetch(`${API}/api/documents/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }, // Omit Content-Type to let browser set boundary
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem("gp_token");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Transactions ─────────────────────────────────────────────────────────────
export async function fetchTransactions(page = 1, limit = 20, status = "", from = "", to = "") {
  const params = new URLSearchParams({
    page: String(page), limit: String(limit),
    ...(status && { status }), ...(from && { from }), ...(to && { to }),
  });
  return apiFetch(`/api/analytics/transactions?${params}`);
}

// ── Blocked ──────────────────────────────────────────────────────────────────
export async function fetchBlocked() {
  return apiFetch("/api/analytics/blocked-numbers");
}

export async function unblockNumber(number: string) {
  return apiFetch(`/api/analytics/blocked/${encodeURIComponent(number)}`, { method: "DELETE" });
}

export async function uploadBroadcastImage(file: File) {
  const token = getToken();
  const formData = new FormData();
  formData.append("image", file);

  const res = await fetch(`${API}/api/broadcast/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem("gp_token");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function sendBulkMessage(message: string, recipients: string[] | "all", imageUrl?: string) {
  return apiFetch("/api/broadcast/send", {
    method: "POST",
    body: JSON.stringify({ message, recipients, imageUrl }),
  });
}

export async function fetchForms() {
  return apiFetch("/api/forms");
}

export async function createForm(name: string, requiredDocuments: string, file: File) {
  const token = getToken();
  const formData = new FormData();
  formData.append("name", name);
  formData.append("required_documents", requiredDocuments);
  formData.append("file", file);

  const res = await fetch(`${API}/api/forms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem("gp_token");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function deleteForm(id: string) {
  return apiFetch(`/api/forms/${id}`, { method: "DELETE" });
}

// ── Property Tax ─────────────────────────────────────────────────────────────
export async function fetchTaxRecords(page = 1, limit = 10, search = "", status = "", sortBy = "created_at", sortOrder = "desc") {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(search && { search }),
    ...(status && { status }),
    ...(sortBy && { sortBy }),
    ...(sortOrder && { sortOrder }),
  });
  return apiFetch(`/api/tax/records?${params}`);
}

export async function createTaxRecord(propertyId: string, ownerName: string, dueAmount: number, mobileNumber: string) {
  return apiFetch("/api/tax/record", {
    method: "POST",
    body: JSON.stringify({ propertyId, ownerName, dueAmount, mobileNumber }),
  });
}

export async function updateTaxRecord(id: string, data: Record<string, unknown>) {
  return apiFetch(`/api/tax/record/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function importTaxExcel(file: File) {
  const token = getToken();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API}/api/tax/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem("gp_token");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function circulateTaxTemplate(template: string) {
  return apiFetch("/api/tax/circulate", {
    method: "POST",
    body: JSON.stringify({ template }),
  });
}

export async function triggerMockTaxWebhook(propertyId: string) {
  return apiFetch("/api/tax/webhook-mock-trigger", {
    method: "POST",
    body: JSON.stringify({ propertyId }),
  });
}

export async function deleteTaxRecord(id: string) {
  return apiFetch(`/api/tax/record/${id}`, {
    method: "DELETE"
  });
}

export async function deleteAllTaxRecords() {
  return apiFetch("/api/tax/records/all", {
    method: "DELETE"
  });
}

export { apiFetch };
