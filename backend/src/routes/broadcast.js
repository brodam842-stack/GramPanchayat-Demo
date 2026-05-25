const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { authenticate } = require('./auth');
const { supabaseAdmin } = require('../config/supabase');
const { client, sendMessage, sendMedia } = require('../config/twilio');
const { logTransaction } = require('../services/authService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// All broadcast routes require admin authentication
router.use(authenticate);

/**
 * POST /api/broadcast/upload
 * Uploads a broadcast attachment image to Supabase storage 'gp-documents' bucket
 */
router.post('/upload', upload.single('image'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No image file uploaded' });

  try {
    const filename = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    const storagePath = `broadcasts/${filename}`;

    const { error } = await supabaseAdmin.storage
      .from('gp-documents')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (error) throw new Error(error.message);

    const { data } = supabaseAdmin.storage
      .from('gp-documents')
      .getPublicUrl(storagePath);

    res.json({ imageUrl: data.publicUrl });
  } catch (err) {
    console.error('[Broadcast] Image upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload image: ' + err.message });
  }
});

/**
 * POST /api/broadcast/send
 * Sends personalized broadcast messages to all or selected active citizens
 */
router.post('/send', async (req, res) => {
  const { message, recipients, imageUrl } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message content is required.' });
  }
  if (!recipients) {
    return res.status(400).json({ error: 'Recipients target is required.' });
  }

  try {
    let citizens = [];

    if (recipients === 'all') {
      const { data, error } = await supabaseAdmin
        .from('citizens')
        .select('id, full_name, mobile_number')
        .eq('is_active', true);
      
      if (error) throw error;
      citizens = data || [];
    } else if (Array.isArray(recipients)) {
      if (recipients.length === 0) {
        return res.status(400).json({ error: 'Recipients array cannot be empty.' });
      }
      const { data, error } = await supabaseAdmin
        .from('citizens')
        .select('id, full_name, mobile_number')
        .in('id', recipients)
        .eq('is_active', true);
      
      if (error) throw error;
      citizens = data || [];
    } else {
      return res.status(400).json({ error: 'Invalid recipients format.' });
    }

    if (citizens.length === 0) {
      return res.status(404).json({ error: 'No active citizens found matching your selection.' });
    }

    const report = {
      total: citizens.length,
      success: 0,
      failed: 0,
      details: [],
    };

    // Process broadcasts sequentially
    for (const citizen of citizens) {
      // Personalization substitution: replace {name} or {{name}} with the actual citizen name
      let customizedMessage = message.replace(/{name}/gi, citizen.full_name);
      customizedMessage = customizedMessage.replace(/{{name}}/gi, citizen.full_name);

      const formattedTo = `whatsapp:+91${citizen.mobile_number}`;
      
      try {
        let response;
        if (imageUrl) {
          response = await sendMedia(formattedTo, customizedMessage, imageUrl);
        } else {
          response = await sendMessage(formattedTo, customizedMessage);
        }

        // Active Delivery Confirmation with Twilio
        let deliveryStatus = 'success';
        let failureReason = null;

        // If client exists and we are not in Mock mode, check delivery status
        if (client && response.sid && response.status !== 'mock') {
          let confirmed = false;
          const startTime = Date.now();
          
          console.log(`[Broadcast] Polling delivery confirmation for SID: ${response.sid} to ${citizen.full_name}`);
          
          while (Date.now() - startTime < 12000) { // Max 12 seconds polling
            const twMsg = await client.messages(response.sid).fetch();
            if (twMsg.status === 'delivered' || twMsg.status === 'read') {
              confirmed = true;
              console.log(`[Broadcast] ✓ Confirmed delivery to ${citizen.full_name}. Status: ${twMsg.status}`);
              break;
            } else if (twMsg.status === 'failed' || twMsg.status === 'undelivered') {
              deliveryStatus = 'failed';
              failureReason = `Twilio delivery status: ${twMsg.status}. Error: ${twMsg.errorMessage || 'Unknown failure'}`;
              console.warn(`[Broadcast] ❌ Delivery failed to ${citizen.full_name}. Status: ${twMsg.status}`);
              break;
            }
            // Wait 1 second between polls
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          if (!confirmed && deliveryStatus !== 'failed') {
            deliveryStatus = 'failed';
            failureReason = 'Twilio delivery confirmation timeout (message sent but status did not become delivered/read within 12 seconds).';
            console.warn(`[Broadcast] ⚠️ Delivery timeout for ${citizen.full_name}`);
          }
        } else {
          // Mock mode or missing client
          console.log(`[Broadcast] [MOCK] Confirmed mock delivery to ${citizen.full_name}`);
        }

        if (deliveryStatus === 'success') {
          // Log transaction inside Supabase audit logs
          await logTransaction({
            citizenId: citizen.id,
            whatsappNumber: formattedTo,
            documentRequested: `Broadcast: ${message.slice(0, 25)}...`,
            status: 'success',
            sessionId: null,
          });

          report.success++;
          report.details.push({
            citizenId: citizen.id,
            name: citizen.full_name,
            mobile: citizen.mobile_number,
            status: 'success',
            sid: response.sid,
          });
        } else {
          // Failed to confirm delivery
          await logTransaction({
            citizenId: citizen.id,
            whatsappNumber: formattedTo,
            documentRequested: `Broadcast: ${message.slice(0, 25)}...`,
            status: 'failed',
            failureReason: failureReason,
            sessionId: null,
          });

          report.failed++;
          report.details.push({
            citizenId: citizen.id,
            name: citizen.full_name,
            mobile: citizen.mobile_number,
            status: 'failed',
            error: failureReason,
          });
        }
      } catch (sendErr) {
        console.error(`[Broadcast] Failed to send to ${citizen.full_name}:`, sendErr.message);

        await logTransaction({
          citizenId: citizen.id,
          whatsappNumber: formattedTo,
          documentRequested: `Broadcast: ${message.slice(0, 25)}...`,
          status: 'failed',
          failureReason: sendErr.message,
          sessionId: null,
        });

        report.failed++;
        report.details.push({
          citizenId: citizen.id,
          name: citizen.full_name,
          mobile: citizen.mobile_number,
          status: 'failed',
          error: sendErr.message,
        });
      }
    }

    res.json({
      message: `Broadcast finished. Success: ${report.success}, Failed: ${report.failed}`,
      report,
    });
  } catch (err) {
    console.error('[Broadcast] Send error:', err.message);
    res.status(500).json({ error: 'Failed to deliver broadcast: ' + err.message });
  }
});

module.exports = router;
