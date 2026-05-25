const express = require('express');
const router  = express.Router();
const { validateSignature } = require('../config/twilio');
const { handleMessage }     = require('../controllers/conversationController');

// ─── Deduplication Store ───────────────────────────────────────────────────────
// Prevents the same MessageSid from being processed more than once.
// Twilio can occasionally deliver duplicate webhooks, and Status Callbacks
// (sent/delivered/read events) can be mistakenly routed here if the Twilio
// Sandbox "Status Callback URL" is set to this same endpoint.
const processedSids = new Set();
const SID_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * POST /webhook/whatsapp
 * Handles ONLY incoming WhatsApp messages from users.
 */
router.post('/', async (req, res) => {
  const messageStatus = req.body.MessageStatus || req.body.SmsStatus;
  const from = req.body.From;
  const body = req.body.Body;
  const sid  = req.body.MessageSid;

  // ── Guard 1: Ignore Twilio STATUS CALLBACKS ──────────────────────────────
  // Twilio POSTs status updates (sent, delivered, read, failed) to ANY webhook
  // URL configured in the console. If the "Status Callback URL" points here,
  // each outgoing bot message would trigger another full bot reply — multiplying
  // messages exponentially. Status callbacks have MessageStatus but NO From.
  if (messageStatus && !from) {
    console.log(`[Webhook] Ignored status callback: ${messageStatus} (SID: ${sid})`);
    return res.status(200).send('<Response></Response>');
  }

  // ── Guard 2: Ignore non-message POSTs (no sender or no text body) ─────────
  if (!from || body === undefined || body === null) {
    console.log('[Webhook] Ignored POST with no From/Body — likely a status ping');
    return res.status(200).send('<Response></Response>');
  }

  // ── Guard 3: Deduplicate — skip if we already handled this SID ───────────
  if (sid && processedSids.has(sid)) {
    console.log(`[Webhook] Duplicate webhook skipped (SID: ${sid})`);
    return res.status(200).send('<Response></Response>');
  }
  if (sid) {
    processedSids.add(sid);
    setTimeout(() => processedSids.delete(sid), SID_EXPIRY_MS);
  }

  // ── Validate Twilio signature (skipped in development) ───────────────────
  if (!validateSignature(req)) {
    console.warn('[Webhook] Invalid Twilio signature — rejected');
    return res.status(403).send('Forbidden');
  }

  console.log(`[Webhook] Incoming from ${from}: "${body}" (SID: ${sid})`);

  // Respond 200 immediately — Twilio requires a fast response
  res.status(200).send('<Response></Response>');

  // Process the message asynchronously so it doesn't block the response
  handleMessage(from, body, sid).catch(err =>
    console.error('[Webhook] Handler error:', err.message)
  );
});

/**
 * GET /webhook/whatsapp/health
 */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
