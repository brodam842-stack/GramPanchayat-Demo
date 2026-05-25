const { supabaseAdmin } = require('../config/supabase');

// In-memory session store (backed by Supabase for persistence)
const memStore = new Map();
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT_MS || '900000', 10); // 15 min

/**
 * Session step constants
 */
const STEPS = {
  MAIN_MENU:       'MAIN_MENU',
  MOBILE:          'MOBILE',
  NAME:            'NAME',
  AADHAAR:         'AADHAAR',
  DOCUMENT_SELECT: 'DOCUMENT_SELECT',
  DELIVERY:        'DELIVERY',
  FORM_SELECT:     'FORM_SELECT',
  COMPLETED:       'COMPLETED',
};

/**
 * Generate session ID from WhatsApp number.
 */
function sessionId(whatsappNumber) {
  return `sess_${whatsappNumber.replace(/\D/g, '')}`;
}

/**
 * Get or create a session.
 */
async function getSession(whatsappNumber) {
  const id = sessionId(whatsappNumber);

  // Check memory first
  if (memStore.has(id)) {
    const s = memStore.get(id);
    // Check expiry
    if (Date.now() - s.lastActivity > SESSION_TIMEOUT) {
      await deleteSession(whatsappNumber);
      return null;
    }
    return s;
  }

  // Fall back to DB
  const { data } = await supabaseAdmin
    .from('bot_sessions')
    .select('*')
    .eq('id', id)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (data) {
    const session = {
      id: data.id,
      whatsappNumber: data.whatsapp_number,
      currentStep: data.current_step,
      mobileNumber: data.mobile_number,
      fullName: data.full_name,
      aadhaarEncrypted: data.aadhaar_encrypted,
      citizenId: data.citizen_id,
      documentList: data.document_list || [],
      retryCount: data.retry_count || 0,
      lastActivity: Date.now(),
    };
    memStore.set(id, session);
    return session;
  }

  return null;
}

/**
 * Create a new session.
 */
async function createSession(whatsappNumber) {
  const id = sessionId(whatsappNumber);
  const session = {
    id,
    whatsappNumber,
    currentStep: STEPS.MAIN_MENU,
    mobileNumber: null,
    fullName: null,
    aadhaarEncrypted: null,
    citizenId: null,
    documentList: [],
    retryCount: 0,
    lastActivity: Date.now(),
  };

  memStore.set(id, session);

  // Persist to DB
  await supabaseAdmin.from('bot_sessions').upsert({
    id,
    whatsapp_number: whatsappNumber,
    current_step: session.currentStep,
    retry_count: 0,
    last_activity: new Date().toISOString(),
    expires_at: new Date(Date.now() + SESSION_TIMEOUT).toISOString(),
  });

  return session;
}

/**
 * Update session fields.
 */
async function updateSession(whatsappNumber, updates) {
  const id = sessionId(whatsappNumber);
  const session = memStore.get(id) || {};
  const updated = { ...session, ...updates, lastActivity: Date.now() };
  memStore.set(id, updated);

  // Persist to DB (best-effort)
  try {
    await supabaseAdmin.from('bot_sessions').upsert({
      id,
      whatsapp_number: whatsappNumber,
      current_step: updated.currentStep,
      mobile_number: updated.mobileNumber,
      full_name: updated.fullName,
      aadhaar_encrypted: updated.aadhaarEncrypted,
      citizen_id: updated.citizenId,
      document_list: updated.documentList,
      retry_count: updated.retryCount,
      last_activity: new Date().toISOString(),
      expires_at: new Date(Date.now() + SESSION_TIMEOUT).toISOString(),
    });
  } catch (err) {
    console.error('[Session] DB persist error:', err.message);
  }

  return updated;
}

/**
 * Delete a session.
 */
async function deleteSession(whatsappNumber) {
  const id = sessionId(whatsappNumber);
  memStore.delete(id);
  try {
    await supabaseAdmin.from('bot_sessions').delete().eq('id', id);
  } catch { /* best-effort */ }
}

/**
 * Clean up expired sessions (run periodically).
 */
async function cleanExpiredSessions() {
  const now = new Date().toISOString();
  try {
    await supabaseAdmin.from('bot_sessions').delete().lt('expires_at', now);
  } catch { /* best-effort */ }
  // Also clean memory store
  for (const [key, session] of memStore.entries()) {
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT) memStore.delete(key);
  }
}

module.exports = { STEPS, getSession, createSession, updateSession, deleteSession, cleanExpiredSessions };
