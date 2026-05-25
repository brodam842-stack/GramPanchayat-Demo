const express  = require('express');
const cors     = require('cors');
const rateLimit = require('express-rate-limit');
const cron     = require('node-cron');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

const webhookRouter   = require('./routes/webhook');
const { router: authRouter } = require('./routes/auth');
const citizensRouter  = require('./routes/citizens');
const analyticsRouter = require('./routes/analytics');
const documentsRouter = require('./routes/documents');
const broadcastRouter = require('./routes/broadcast');
const formsRouter = require('./routes/forms');
const { cleanExpiredSessions } = require('./services/sessionManager');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Trust proxy (Ngrok / Nginx) ──────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Stricter limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts.' },
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.DASHBOARD_URL || 'http://localhost:3001']
    : '*',
  credentials: true,
}));

// ─── Body Parsers ─────────────────────────────────────────────────────────────
// Twilio sends urlencoded form data
app.use('/webhook', express.urlencoded({ extended: false }));
app.use(express.json({ limit: '10mb' }));
app.use(globalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/webhook/whatsapp', webhookRouter);
app.use('/api/auth',         authLimiter, authRouter);
app.use('/api/citizens',     citizensRouter);
app.use('/api/analytics',    analyticsRouter);
app.use('/api/documents',    documentsRouter);
app.use('/api/broadcast',    broadcastRouter);
app.use('/api/forms',        formsRouter);

// ─── Static Media Serving (for Twilio PDF delivery via Ngrok) ─────────────────
const os = require('os');
const MEDIA_DIR = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, '../storage/temp-media');
if (!process.env.VERCEL && !fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR));
console.log(`[Media] Serving temp PDFs from: ${MEDIA_DIR}`);
console.log(`[Media] Public URL: ${process.env.PUBLIC_URL || 'NOT SET — add PUBLIC_URL to .env'}/media/`);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    service: 'Gram Panchayat WhatsApp Bot',
    version: '1.0.0',
    status:  'running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Scheduled Jobs / Cron ────────────────────────────────────────────────────
// In a long-running server (like local or Railway), use node-cron
if (!process.env.VERCEL) {
  cron.schedule('*/5 * * * *', () => {
    cleanExpiredSessions().catch(err => console.error('[Cron] Session cleanup error:', err.message));
  });
}

// In a serverless environment (Vercel), expose an endpoint for Vercel Cron
app.get('/api/cron/cleanup', async (req, res) => {
  try {
    await cleanExpiredSessions();
    res.json({ success: true, message: 'Sessions cleaned' });
  } catch (err) {
    console.error('[Vercel Cron] Cleanup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🏛  Gram Panchayat WhatsApp Bot Backend`);
    console.log(`📡  Server running on http://localhost:${PORT}`);
    console.log(`🔗  Webhook: http://localhost:${PORT}/webhook/whatsapp`);
    console.log(`🛠️  Admin API: http://localhost:${PORT}/api`);
    console.log(`🌱  Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });
}

module.exports = app;
