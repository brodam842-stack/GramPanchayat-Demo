const { supabaseAdmin } = require('../config/supabase');
const { encrypt, decrypt, normalizeAadhaar, maskAadhaar } = require('../utils/encryption');
const { fuzzyMatchName } = require('../utils/fuzzyMatch');

const MAX_RETRIES = parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10);
const BLOCK_DURATION = parseInt(process.env.BLOCK_DURATION_MS || '1800000', 10); // 30 min

/**
 * Check if a WhatsApp number is currently blocked.
 * @param {string} whatsappNumber
 * @returns {{ blocked: boolean, blockedUntil: Date|null }}
 */
async function isBlocked(whatsappNumber) {
  const { data } = await supabaseAdmin
    .from('failed_attempts')
    .select('blocked_until')
    .eq('whatsapp_number', whatsappNumber)
    .not('blocked_until', 'is', null)
    .gt('blocked_until', new Date().toISOString())
    .order('blocked_until', { ascending: false })
    .limit(1)
    .single();

  if (data?.blocked_until) {
    return { blocked: true, blockedUntil: new Date(data.blocked_until) };
  }
  return { blocked: false, blockedUntil: null };
}

/**
 * Record a failed verification attempt and block if threshold exceeded.
 * @param {string} whatsappNumber
 * @param {string} attemptType     - 'mobile' | 'name' | 'aadhaar'
 * @param {number} currentRetry    - Current retry count in session
 * @returns {{ blocked: boolean, remaining: number }}
 */
async function recordFailedAttempt(whatsappNumber, attemptType, currentRetry) {
  const remaining = MAX_RETRIES - currentRetry - 1;
  const shouldBlock = remaining <= 0;

  const payload = {
    whatsapp_number: whatsappNumber,
    attempt_type: attemptType,
    attempt_count: currentRetry + 1,
    attempt_timestamp: new Date().toISOString(),
    blocked_until: shouldBlock ? new Date(Date.now() + BLOCK_DURATION).toISOString() : null,
  };

  try {
    await supabaseAdmin.from('failed_attempts').insert(payload);
  } catch (err) {
    console.error('[Auth] Failed to log attempt:', err.message);
  }

  return { blocked: shouldBlock, remaining: Math.max(0, remaining) };
}

/**
 * Verify mobile number — check if citizen exists.
 * @param {string} mobileNumber
 * @returns {{ valid: boolean, citizen: object|null, error: string|null }}
 */
async function verifyMobile(mobileNumber) {
  const { data, error } = await supabaseAdmin
    .from('citizens')
    .select('id, mobile_number, full_name, aadhaar_number_encrypted, aadhaar_last4, date_of_birth, is_active')
    .eq('mobile_number', mobileNumber)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return { valid: false, citizen: null, error: 'NOT_FOUND' };
  }
  return { valid: true, citizen: data, error: null };
}

/**
 * Verify full name with fuzzy matching.
 * @param {string} inputName
 * @param {string} storedName
 * @returns {{ valid: boolean, score: number }}
 */
function verifyName(inputName, storedName) {
  const { match, score } = fuzzyMatchName(inputName, storedName);
  return { valid: match, score };
}

/**
 * Verify Aadhaar number against encrypted stored value.
 * @param {string} inputAadhaar   - Raw input (cleaned 12 digits)
 * @param {string} encrypted      - Stored encrypted Aadhaar
 * @param {string} last4          - Stored last 4 digits (for quick pre-check)
 * @returns {{ valid: boolean }}
 */
function verifyAadhaar(inputAadhaar, encrypted, last4) {
  const cleanInput = normalizeAadhaar(inputAadhaar);

  // Quick check: last 4 must match
  if (cleanInput.slice(-4) !== last4) return { valid: false };

  // Decrypt and compare full number
  try {
    const decrypted = decrypt(encrypted);
    return { valid: decrypted === cleanInput };
  } catch {
    return { valid: false };
  }
}

/**
 * Log a transaction in the database.
 */
async function logTransaction({ citizenId, whatsappNumber, documentRequested, status, failureReason, sessionId }) {
  try {
    const { error } = await supabaseAdmin.from('transaction_logs').insert({
      citizen_id: citizenId,
      whatsapp_number: whatsappNumber,
      document_requested: documentRequested,
      request_timestamp: new Date().toISOString(),
      delivery_status: status,
      failure_reason: failureReason || null,
      session_id: sessionId,
    });
    if (error) {
      console.error('[Auth] Supabase error logging transaction:', error.message, error.details);
    }
  } catch (err) {
    console.error('[Auth] Failed to log transaction:', err.message);
  }
}

module.exports = { isBlocked, recordFailedAttempt, verifyMobile, verifyName, verifyAadhaar, logTransaction };
