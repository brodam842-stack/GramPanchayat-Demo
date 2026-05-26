const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const xlsx    = require('xlsx');
const Razorpay = require('razorpay');
const crypto  = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { authenticate } = require('./auth');
const { supabaseAdmin } = require('../config/supabase');
const { sendMessage, sendMedia } = require('../config/twilio');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// Initialize Razorpay
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  try {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('[Razorpay] SDK initialized successfully.');
  } catch (err) {
    console.error('[Razorpay] Init error:', err.message);
  }
} else {
  console.warn('[Razorpay] ⚠️ Credentials not configured. Running in Mock Mode.');
}

// Helper: Convert English/ASCII representation for PDF compatibility (since standard PDF fonts only support WinAnsi)
function sanitizeForPDF(text) {
  if (!text) return '';
  // Mapping or removing non-ASCII characters to prevent PDF generation errors
  return text.toString()
    .replace(/[\u0100-\uffff]/g, '') // Remove non-latin
    .trim();
}

// Helper: Build a beautiful PDF receipt
async function generatePDFReceipt(record, paymentId) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 Size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Background Border Card
  page.drawRectangle({
    x: 20,
    y: 20,
    width: 555,
    height: 802,
    borderWidth: 2,
    borderColor: rgb(0.1, 0.45, 0.25), // Forest Green
    color: rgb(0.98, 0.99, 0.98),
  });

  // Top Header Banner
  page.drawRectangle({
    x: 22,
    y: 720,
    width: 551,
    height: 100,
    color: rgb(0.1, 0.45, 0.25),
  });

  // Header Text
  page.drawText('GRAM PANCHAYAT DIGITAL TAX RECEIPT', {
    x: 50,
    y: 775,
    size: 20,
    font: boldFont,
    color: rgb(1, 1, 1),
  });

  page.drawText('OFFICIAL ONLINE PAYMENT SLIP', {
    x: 50,
    y: 745,
    size: 12,
    font: font,
    color: rgb(0.9, 0.9, 0.9),
  });

  // Receipt Details Title
  page.drawText('TRANSACTION DETAILS', {
    x: 50,
    y: 660,
    size: 16,
    font: boldFont,
    color: rgb(0.1, 0.45, 0.25),
  });

  page.drawLine({
    start: { x: 50, y: 650 },
    end: { x: 545, y: 650 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });

  const detailsYStart = 600;
  const lineSpacing = 30;

  const data = [
    { label: 'Property ID (Milkat No):', value: record.property_id },
    { label: 'Owner Name:', value: sanitizeForPDF(record.owner_name) || 'Taxpayer' },
    { label: 'Mobile Number:', value: `+91 ${record.mobile_number}` },
    { label: 'Amount Paid:', value: `INR ${parseFloat(record.due_amount).toFixed(2)}` },
    { label: 'Payment Status:', value: 'PAID (ONLINE SUCCESS)' },
    { label: 'Razorpay Payment ID:', value: paymentId || 'N/A' },
    { label: 'Transaction Date:', value: new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) },
  ];

  data.forEach((item, index) => {
    const y = detailsYStart - (index * lineSpacing);
    page.drawText(item.label, {
      x: 50,
      y,
      size: 11,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(item.value, {
      x: 250,
      y,
      size: 11,
      font: font,
      color: rgb(0.3, 0.3, 0.3),
    });
  });

  // Signature Block
  page.drawText('Authorized Signatory', {
    x: 400,
    y: 200,
    size: 11,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText('Gram Panchayat Admin', {
    x: 400,
    y: 185,
    size: 10,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawLine({
    start: { x: 380, y: 215 },
    end: { x: 520, y: 215 },
    thickness: 1,
    color: rgb(0.6, 0.6, 0.6),
  });

  // Important Notice Banner at bottom
  page.drawRectangle({
    x: 35,
    y: 50,
    width: 525,
    height: 70,
    color: rgb(0.95, 0.95, 0.95),
    borderWidth: 1,
    borderColor: rgb(0.8, 0.8, 0.8),
  });

  page.drawText('IMPORTANT NOTE FOR CITIZEN', {
    x: 50,
    y: 100,
    size: 10,
    font: boldFont,
    color: rgb(0.8, 0.2, 0.2),
  });

  page.drawText('This is a computer-generated online payment slip for immediate validation. Please collect', {
    x: 50,
    y: 82,
    size: 9.5,
    font: font,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawText('the real physical receipt from the Gram Panchayat office at any time you want.', {
    x: 50,
    y: 67,
    size: 9.5,
    font: boldFont,
    color: rgb(0.1, 0.45, 0.25),
  });

  return await pdfDoc.save();
}

// ─── POST /api/tax/import ─────────────────────────────────────────────────────
router.post('/import', authenticate, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Please upload an Excel file.' });

  try {
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];
    const rows      = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const importedRecords = [];
    
    // Self-healing parsing starting from row 4 (index 3) to skip metadata/titles
    for (let i = 4; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const propertyId = row[0]?.toString().trim();
      const ownerName  = row[1]?.toString().trim() || row[2]?.toString().trim();
      
      // Extract due tax
      let rawDue = row[3]?.toString().replace(/[^0-9.]/g, '') || '0';
      const dueAmount = parseFloat(rawDue) || 0.00;

      // Skip rows with no property ID or 0 due
      if (!propertyId || isNaN(dueAmount) || dueAmount <= 0) continue;

      // Scan all cells in this row for a valid 10-digit mobile number
      let mobileNumber = '';
      for (const cell of row) {
        if (cell) {
          const cleaned = cell.toString().replace(/[^0-9]/g, '');
          if (cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned)) {
            mobileNumber = cleaned;
            break;
          }
        }
      }

      // If no valid mobile number is found, we can skip or set a default placeholder
      if (!mobileNumber) continue;

      importedRecords.push({
        property_id: propertyId,
        owner_name: ownerName || 'Property Holder',
        due_amount: dueAmount,
        mobile_number: mobileNumber,
        payment_status: 'pending'
      });
    }

    if (importedRecords.length === 0) {
      return res.status(400).json({ error: 'No valid pending tax records found in the Excel sheet.' });
    }

    // Upsert into Supabase (match by property_id)
    const { error } = await supabaseAdmin
      .from('tax_records')
      .upsert(importedRecords, { onConflict: 'property_id' });

    if (error) throw error;

    res.json({
      message: `Successfully imported and updated ${importedRecords.length} property tax records!`,
      count: importedRecords.length
    });
  } catch (err) {
    console.error('[Tax] Import error:', err.message);
    res.status(500).json({ error: 'Failed to import tax sheet: ' + err.message });
  }
});

// ─── GET /api/tax/records ─────────────────────────────────────────────────────
router.get('/records', authenticate, async (req, res) => {
  const page      = parseInt(req.query.page || '1', 10);
  const limit     = parseInt(req.query.limit || '10', 10);
  const search    = req.query.search || '';
  const status    = req.query.status || '';
  const sortBy    = req.query.sortBy || 'created_at';
  const sortOrder = req.query.sortOrder || 'desc';

  try {
    let query = supabaseAdmin
      .from('tax_records')
      .select('*', { count: 'exact' });

    if (search) {
      query = query.or(`property_id.ilike.%${search}%,owner_name.ilike.%${search}%,mobile_number.ilike.%${search}%`);
    }
    if (status) {
      query = query.eq('payment_status', status);
    }

    // Pagination
    const fromOffset = (page - 1) * limit;
    const toOffset   = fromOffset + limit - 1;

    const allowedSortBy = ['created_at', 'property_id', 'due_amount', 'owner_name'];
    const actualSortBy = allowedSortBy.includes(sortBy) ? sortBy : 'created_at';
    const ascending = sortOrder === 'asc';

    const { data, count, error } = await query
      .order(actualSortBy, { ascending })
      .range(fromOffset, toOffset);

    if (error) throw error;

    res.json({
      records: data || [],
      total: count || 0,
      page,
      pages: Math.ceil((count || 0) / limit)
    });
  } catch (err) {
    console.error('[Tax] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tax records: ' + err.message });
  }
});

// ─── POST /api/tax/record (Manual Create) ──────────────────────────────────────
router.post('/record', authenticate, async (req, res) => {
  const { propertyId, ownerName, dueAmount, mobileNumber } = req.body;

  if (!propertyId || !ownerName || !dueAmount || !mobileNumber) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('tax_records')
      .insert({
        property_id: propertyId.trim(),
        owner_name: ownerName.trim(),
        due_amount: parseFloat(dueAmount),
        mobile_number: mobileNumber.replace(/[^0-9]/g, ''),
        payment_status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ record: data, message: 'Tax record created successfully.' });
  } catch (err) {
    console.error('[Tax] Manual create error:', err.message);
    res.status(500).json({ error: 'Failed to create tax record: ' + err.message });
  }
});

// ─── PUT /api/tax/record/:id (Manual Edit) ────────────────────────────────────
router.put('/record/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { propertyId, ownerName, dueAmount, mobileNumber, paymentStatus } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('tax_records')
      .update({
        property_id: propertyId?.trim(),
        owner_name: ownerName?.trim(),
        due_amount: dueAmount ? parseFloat(dueAmount) : undefined,
        mobile_number: mobileNumber ? mobileNumber.replace(/[^0-9]/g, '') : undefined,
        payment_status: paymentStatus || undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ record: data, message: 'Tax record updated successfully.' });
  } catch (err) {
    console.error('[Tax] Manual edit error:', err.message);
    res.status(500).json({ error: 'Failed to update tax record: ' + err.message });
  }
});

// ─── DELETE /api/tax/records/all (Bulk Delete All Records) ───────────────────
router.delete('/records/all', authenticate, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('tax_records')
      .delete()
      .gt('created_at', '1970-01-01Z'); // Standard filter to clear all rows

    if (error) throw error;

    res.json({ message: 'All property tax records have been successfully deleted.' });
  } catch (err) {
    console.error('[Tax] Bulk delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete all tax records: ' + err.message });
  }
});

// ─── DELETE /api/tax/record/:id (Delete Individual Record) ───────────────────
router.delete('/record/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('tax_records')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Tax record deleted successfully.' });
  } catch (err) {
    console.error('[Tax] Individual delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete tax record: ' + err.message });
  }
});


// ─── POST /api/tax/circulate (Bulk Send) ──────────────────────────────────────
router.post('/circulate', authenticate, async (req, res) => {
  const { template } = req.body;
  if (!template) return res.status(400).json({ error: 'Message template content is required.' });

  try {
    // Fetch all pending tax records
    const { data: records, error } = await supabaseAdmin
      .from('tax_records')
      .select('*')
      .eq('payment_status', 'pending');

    if (error) throw error;

    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'No pending tax records found to circulate.' });
    }

    const report = { total: records.length, success: 0, failed: 0 };

    for (const record of records) {
      let paymentLink = record.payment_link;

      // Generate Razorpay Payment Link if not already generated
      if (!paymentLink) {
        if (razorpay) {
          try {
            const linkData = await razorpay.paymentLink.create({
              amount: Math.round(record.due_amount * 100), // Paise
              currency: 'INR',
              accept_partial: false,
              description: `Property Tax Due for Property ID: ${record.property_id}`,
              customer: {
                name: record.owner_name,
                contact: `+91${record.mobile_number}`
              },
              notify: { sms: false, email: false },
              reminder_enable: true,
              callback_url: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/tax/callback`,
              callback_method: 'get'
            });

            paymentLink = linkData.short_url;

            // Update record in Supabase
            await supabaseAdmin
              .from('tax_records')
              .update({
                razorpay_payment_link_id: linkData.id,
                payment_link: paymentLink
              })
              .eq('id', record.id);

          } catch (rzpErr) {
            console.error(`[Razorpay] Link generation failed for ${record.owner_name}:`, rzpErr.message);
          }
        } else {
          // Mock mode fallback
          paymentLink = `https://rzp.io/i/mock_tax_${record.id.substring(0, 8)}`;
          await supabaseAdmin
            .from('tax_records')
            .update({ payment_link: paymentLink })
            .eq('id', record.id);
        }
      }

      if (!paymentLink) {
        report.failed++;
        continue;
      }

      // Compile customized template message
      let msg = template
        .replace(/{owner_name}/gi, record.owner_name)
        .replace(/{property_id}/gi, record.property_id)
        .replace(/{due_amount}/gi, parseFloat(record.due_amount).toFixed(2))
        .replace(/{payment_link}/gi, paymentLink);

      const formattedTo = `whatsapp:+91${record.mobile_number}`;

      try {
        await sendMessage(formattedTo, msg);
        report.success++;
      } catch (twilioErr) {
        console.error(`[Twilio] Bulk tax alert failed for ${record.mobile_number}:`, twilioErr.message);
        report.failed++;
      }
    }

    res.json({
      message: `Tax circulation complete! Success: ${report.success}, Failed: ${report.failed}`,
      report
    });
  } catch (err) {
    console.error('[Tax] Circulation error:', err.message);
    res.status(500).json({ error: 'Failed to circulate tax alerts: ' + err.message });
  }
});

// ─── POST /api/tax/webhook (Razorpay Webhook Confirmation) ──────────────────
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET || 'gp-webhook-secret';
  
  if (!signature) {
    return res.status(400).json({ error: 'Missing Razorpay signature header.' });
  }

  try {
    // Validate Signature using raw body buffer
    const rawBodyData = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBodyData)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.warn('[Webhook] Razorpay signature mismatch!');
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const event   = payload.event;
    console.log(`[Webhook] Razorpay Event captured: ${event}`);

    if (event === 'payment_link.paid' || event === 'payment.captured') {
      const entity = payload.payload.payment_link?.entity || payload.payload.payment?.entity;
      if (!entity) {
        console.error('[Webhook] Payload entity not found.');
        return res.status(400).json({ error: 'Payload entity not found.' });
      }

      const linkId     = entity.id || entity.payment_link_id;
      const paymentId  = payload.payload.payment?.entity?.id || 'pay_online_success';
      console.log(`[Webhook] Extracting details - linkId: ${linkId}, paymentId: ${paymentId}`);

      // Find the associated pending tax record
      console.log('[Webhook] Querying tax_records for linkId:', linkId);
      let { data: record, error: fetchErr } = await supabaseAdmin
        .from('tax_records')
        .select('*')
        .eq('razorpay_payment_link_id', linkId)
        .eq('payment_status', 'pending')
        .limit(1)
        .single();

      if (fetchErr) {
        console.log('[Webhook] First query error or not found:', fetchErr.message);
      }

      // Fallback: If not found by link ID, try matching by description or order reference
      if (fetchErr || !record) {
        const description = entity.description || '';
        console.log(`[Webhook] Fallback triggered. Entity description: "${description}"`);
        const propIdMatch = description.match(/Property ID:?\s*([a-zA-Z0-9_\-]+)/i);
        if (propIdMatch) {
          const matchedPropId = propIdMatch[1];
          console.log(`[Webhook] Fallback: Matched Property ID: "${matchedPropId}". Querying...`);
          const { data: fallbackRecord, error: fallbackErr } = await supabaseAdmin
            .from('tax_records')
            .select('*')
            .eq('property_id', matchedPropId)
            .eq('payment_status', 'pending')
            .limit(1)
            .single();

          if (fallbackErr) {
            console.error('[Webhook] Fallback query error:', fallbackErr.message);
          } else {
            console.log('[Webhook] Fallback query succeeded! Found record ID:', fallbackRecord?.id);
            record = fallbackRecord;
          }
        } else {
          console.log('[Webhook] Fallback: No property ID match found in description.');
        }
      }

      if (!record) {
        console.warn(`[Webhook] No pending tax record matches linkId: ${linkId}`);
        return res.json({ status: 'ignored', message: 'No matching pending tax record found.' });
      }

      console.log('[Webhook] Found record to update. ID:', record.id, 'Property ID:', record.property_id);

      // Generate official PDF invoice receipt
      console.log('[Webhook] Generating PDF receipt...');
      const pdfBytes   = await generatePDFReceipt(record, paymentId);
      const safeName   = record.property_id.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const storagePath = `delivery/${Date.now()}_tax_receipt_${safeName}.pdf`;

      // Upload PDF to the public gp-delivery bucket
      console.log('[Webhook] Uploading PDF receipt to storage path:', storagePath);
      const { error: uploadError } = await supabaseAdmin.storage
        .from('gp-delivery')
        .upload(storagePath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        console.error('[Webhook] PDF upload error:', uploadError.message);
        throw uploadError;
      }

      const { data: urlData } = supabaseAdmin.storage
        .from('gp-delivery')
        .getPublicUrl(storagePath);

      const publicPdfUrl = urlData.publicUrl;
      console.log('[Webhook] PDF receipt uploaded successfully. Public URL:', publicPdfUrl);

      // Update tax record status in Database
      console.log('[Webhook] Updating tax record payment status to paid in DB...');
      const { data: updateData, error: updateErr } = await supabaseAdmin
        .from('tax_records')
        .update({
          payment_status: 'paid',
          razorpay_payment_id: paymentId,
          receipt_pdf_url: publicPdfUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', record.id)
        .select();

      if (updateErr) {
        console.error('[Webhook] Error updating database:', updateErr.message);
        throw updateErr;
      }

      console.log('[Webhook] Database update response:', updateData);

      // Deliver PDF receipt to citizen via WhatsApp
      const formattedTo = `whatsapp:+91${record.mobile_number}`;
      const caption = `🎉 *Property Tax Payment Confirmed!*\n\n` +
                      `🏠 *Property ID:* ${record.property_id}\n` +
                      `👤 *Name:* ${record.owner_name}\n` +
                      `💰 *Amount Paid:* ₹${parseFloat(record.due_amount).toFixed(2)}\n` +
                      `🔒 *Payment ID:* ${paymentId}\n\n` +
                      `Attached is your digital payment receipt.\n\n` +
                      `_Note: Please collect the real physical receipt from the Gram Panchayat office at any time you want._`;

      try {
        await sendMedia(formattedTo, caption, publicPdfUrl);
        console.log(`[Webhook] Receipt sent successfully to ${record.mobile_number}`);
      } catch (twilioErr) {
        console.warn(`[Webhook] Warning: payment confirmed but WhatsApp receipt delivery failed: ${twilioErr.message}`);
      }
    }

    res.json({ status: 'success' });
  } catch (err) {
    console.error('[Webhook] Razorpay webhook handling error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper for Mock Webhook triggering (useful during manual/local testing)
router.post('/webhook-mock-trigger', authenticate, async (req, res) => {
  const { propertyId } = req.body;
  if (!propertyId) return res.status(400).json({ error: 'Property ID required.' });

  try {
    const { data: record, error } = await supabaseAdmin
      .from('tax_records')
      .select('*')
      .eq('property_id', propertyId)
      .eq('payment_status', 'pending')
      .single();

    if (error || !record) return res.status(404).json({ error: 'Pending tax record not found.' });

    // Build mock Razorpay webhook trigger payload
    const mockPayload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: record.razorpay_payment_link_id || 'plink_mock_id',
            description: `Property Tax Due for Property ID: ${record.property_id}`
          }
        },
        payment: {
          entity: {
            id: 'pay_mock_success_12345'
          }
        }
      }
    };

    const webhookUrl = 'http://localhost:' + (process.env.PORT || '3000') + '/api/tax/webhook';
    
    // Generate signature locally to bypass authentication
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'gp-webhook-secret';
    const rawBody = JSON.stringify(mockPayload);
    const mockSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const triggerResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': mockSignature
      },
      body: rawBody
    });

    const triggerResult = await triggerResponse.json();
    if (!triggerResponse.ok) throw new Error(triggerResult.error || 'Trigger failed');

    res.json({ message: 'Mock payment webhook triggered and processed successfully!', triggerResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
