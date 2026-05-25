const twilio = require('twilio');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

console.log('[Twilio Debug] SID:', accountSid ? accountSid.substring(0, 5) + '...' : 'MISSING');
console.log('[Twilio Debug] Token:', authToken ? 'EXISTS (length: ' + authToken.length + ')' : 'MISSING');

// Only instantiate if credentials look valid (must start with 'AC')
let client = null;
if (accountSid && authToken && accountSid.trim().startsWith('AC')) {
  try {
    client = twilio(accountSid, authToken);
    console.log('[Twilio] Client initialised successfully.');
  } catch (err) {
    console.warn('[Twilio] Failed to initialise client:', err.message);
  }
} else {
  console.warn('[Twilio] ⚠️  Credentials not configured — running in MOCK mode. Messages will be logged only.');
}

/**
 * Send a plain text WhatsApp message via Twilio.
 * @param {string} to   - E.164 WhatsApp number e.g. whatsapp:+919876543210
 * @param {string} body - Message text
 */
async function sendMessage(to, body) {
  if (!client) {
    console.warn('[Twilio] Client not initialised — credentials missing. Would send:', { to, body });
    return { sid: 'MOCK_SID', status: 'mock' };
  }
  try {
    const msg = await client.messages.create({ from: fromNumber, to, body });
    console.log(`[Twilio] Message sent to ${to}. SID: ${msg.sid}`);
    return msg;
  } catch (err) {
    console.error(`[Twilio] Send failed:`, err.message);
    throw new Error(`Failed to send WhatsApp message: ${err.message}`);
  }
}

/**
 * Send a media (PDF) message via Twilio.
 * @param {string} to       - E.164 WhatsApp number
 * @param {string} body     - Caption text
 * @param {string} mediaUrl - Public URL of the media file
 */
async function sendMedia(to, body, mediaUrl) {
  if (!client) {
    console.warn('[Twilio] Client not initialised — would send media:', { to, mediaUrl });
    return { sid: 'MOCK_SID', status: 'mock' };
  }
  try {
    const msg = await client.messages.create({ from: fromNumber, to, body, mediaUrl: [mediaUrl] });
    console.log(`[Twilio] Media sent to ${to}. SID: ${msg.sid}`);
    return msg;
  } catch (err) {
    console.error(`[Twilio] Media send failed:`, err.message);
    throw new Error(`Failed to send media message: ${err.message}`);
  }
}

/**
 * Validate Twilio webhook signature.
 */
function validateSignature(req) {
  if (!client || process.env.NODE_ENV === 'development') return true;
  const signature = req.headers['x-twilio-signature'];
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, url, req.body);
}

module.exports = { client, sendMessage, sendMedia, validateSignature };
