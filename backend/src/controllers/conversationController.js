const { STEPS, getSession, createSession, updateSession, deleteSession } = require('../services/sessionManager');
const { isBlocked, recordFailedAttempt, verifyMobile, verifyName, verifyAadhaar, logTransaction } = require('../services/authService');
const { listDocuments, downloadDocument } = require('../services/driveService');
const { protectPDF } = require('../services/pdfService');
const { sendMessage, sendMedia } = require('../config/twilio');
const { validateMobile, validateAadhaar, validateName, validateDocumentChoice } = require('../utils/validators');
const { normalizeAadhaar, encrypt, maskAadhaar } = require('../utils/encryption');
const { supabaseAdmin } = require('../config/supabase');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── Message Templates ─────────────────────────────────────────────────────────

const MSG = {
  welcome: (name = 'Sample Gram Panchayat') =>
    `🙏 *Welcome to ${name} Digital Service*\n\n` +
    `How can I assist you today? Please reply with the option number:\n\n` +
    `1️⃣ *Download Blank Application Forms* (No login required)\n` +
    `2️⃣ *Retrieve Personal Documents* (Identity verification required)\n` +
    `3️⃣ *Pay Property Tax* (Razorpay online payment)\n\n` +
    `Reply with *1*, *2* or *3* to choose.`,

  formList: (forms) => {
    const list = forms.map((f, i) => `${i + 1}️⃣ ${f.name}`).join('\n');
    return `📝 *Gram Panchayat Application Forms*\n\n` +
           `Available forms to download:\n${list}\n\n` +
           `Reply with the *number* of the form you need.`;
  },

  formDelivery: (formName, reqDocs) =>
    `📄 *Form:* ${formName}\n\n` +
    `📂 *Required Documents to submit:* \n${reqDocs}\n\n` +
    `Need anything else? Reply *Yes* or *No*`,

  askName: () =>
    `✅ Mobile number verified!\n\n` +
    `Please enter your *full name* as registered with the gram panchayat.`,

  askAadhaar: () =>
    `✅ Name verified!\n\n` +
    `Please enter the *last 4 digits* of your Aadhaar number.\n` +
    `_(For example, if your Aadhaar is XXXX-XXXX-3456, enter *3456*)_`,

  documentList: (docs) => {
    const list = docs.map(d => `${d.index}️⃣ ${d.label}`).join('\n');
    return `✅ *Identity verified successfully!*\n\n` +
           `Your available documents:\n${list}\n\n` +
           `Reply with the *number* of the document you need.`;
  },

  invalidMobile: () =>
    `❌ *Invalid mobile number.*\n\nPlease enter a valid 10-digit Indian mobile number.\nExample: *9876543210*`,

  mobileNotFound: (office = '+91-XXXXXXXXXX', hours = '10 AM - 5 PM') =>
    `❌ *Mobile number not found* in our records.\n\n` +
    `Please contact your gram panchayat office:\n📞 ${office}\n🕐 ${hours} (Mon–Sat)`,

  nameRetry: (remaining) =>
    `❌ *Name doesn't match* our records.\n\n` +
    `Please enter your name *exactly as registered*.\n` +
    `You have *${remaining} attempt(s)* remaining.`,

  aadhaarRetry: (remaining) =>
    `❌ *Aadhaar number doesn't match* our records.\n` +
    `You have *${remaining} attempt(s)* remaining.`,

  blocked: (until) => {
    const mins = Math.ceil((until - Date.now()) / 60000);
    return `⛔ *Access temporarily blocked* due to too many failed attempts.\n\n` +
           `Please try again in *${mins} minutes* or contact your gram panchayat office.`;
  },

  documentDelivery: (docName) =>
    `📄 Here is your *${docName}*\n\n` +
    `🔒 This PDF is password-protected for your security.\n\n` +
    `*Password:* Your date of birth in *DDMMYYYY* format\n` +
    `Example: If DOB is 15th March 1990 → *15031990*\n\n` +
    `Need another document? Reply *Yes* or *No*`,

  anotherDoc: () =>
    `Do you need another document?\n\nReply *Yes* or *No*`,

  goodbye: () =>
    `🙏 Thank you for using our service!\n\n` +
    `Have a great day! If you need any help, contact your gram panchayat office.`,

  sessionExpired: () =>
    `⏰ *Your session has expired* due to inactivity.\n\nPlease start again by sending *Hi*.`,

  genericError: () =>
    `⚠️ Service temporarily unavailable. Please try again in a few minutes.`,

  invalidChoice: (max) =>
    `❌ Invalid choice. Please reply with a number between *1* and *${max}*.`,

  invalidInput: () =>
    `❓ I didn't understand that. Please follow the instructions above.`,
};

// ─── Get panchayat config helper ──────────────────────────────────────────────

let configCache = null;
async function getPanchayatConfig() {
  if (configCache) return configCache;
  const { data } = await supabaseAdmin.from('panchayat_config').select('key, value');
  if (data) {
    configCache = Object.fromEntries(data.map(r => [r.key, r.value]));
    // Refresh cache every 5 min
    setTimeout(() => { configCache = null; }, 5 * 60 * 1000);
  }
  return configCache || {};
}

// ─── Block reminder cooldown (in-memory) ──────────────────────────────────────
// Prevents sending a blocked message on EVERY incoming message from a blocked user.
// We only remind them once every 10 minutes.
const blockReminderSent = new Map(); // whatsappNumber -> timestamp
const BLOCK_REMINDER_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function shouldSendBlockReminder(from) {
  const last = blockReminderSent.get(from);
  if (!last || Date.now() - last > BLOCK_REMINDER_COOLDOWN_MS) {
    blockReminderSent.set(from, Date.now());
    return true;
  }
  return false;
}

// ─── Format DOB as DDMMYYYY ───────────────────────────────────────────────────
function dobToPassword(dob) {
  const d = new Date(dob);
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

// ─── Upload PDF to Supabase Storage and return public URL ────────────────────
async function savePDFForDelivery(pdfBuffer, docName) {
  const safeName = docName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const filename  = `delivery/${Date.now()}_${safeName}.pdf`;

  try {
    const { error } = await supabaseAdmin.storage
      .from('gp-delivery')
      .upload(filename, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) throw new Error(error.message);

    // Public URL for the gp-delivery bucket
    const { data: urlData } = supabaseAdmin.storage
      .from('gp-delivery')
      .getPublicUrl(filename);

    const mediaUrl = urlData?.publicUrl || null;
    console.log(`[PDF] Uploaded to Supabase Storage. URL: ${mediaUrl}`);

    // Schedule deletion after 10 minutes to keep storage clean
    setTimeout(async () => {
      await supabaseAdmin.storage.from('gp-delivery').remove([filename]);
    }, 10 * 60 * 1000);

    return { filename, mediaUrl };
  } catch (err) {
    console.error('[PDF] Supabase Storage upload failed:', err.message);
    // Fallback to local temp file with PUBLIC_URL
    const publicUrl = process.env.PUBLIC_URL;
    const os = require('os');
    const tmpDir = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, '../../storage/temp-media');
    
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const localFile = path.join(tmpDir, `${Date.now()}_${safeName}.pdf`);
    fs.writeFileSync(localFile, pdfBuffer);
    const mediaUrl = publicUrl ? `${publicUrl.replace(/\/$/, '')}/media/${path.basename(localFile)}` : null;
    return { filename: localFile, mediaUrl };
  }
}

// ─── Main Conversation Handler ────────────────────────────────────────────────

/**
 * Handle an incoming WhatsApp message.
 * @param {string} from    - WhatsApp sender number e.g. "whatsapp:+919876543210"
 * @param {string} body    - Message text
 * @param {string} msgSid  - Twilio message SID
 */
async function handleMessage(from, body, msgSid) {
  const input = (body || '').trim();
  const config = await getPanchayatConfig();

  // ── Check if blocked ──────────────────────────────────────────────────────
  const blockStatus = await isBlocked(from);
  if (blockStatus.blocked) {
    // Only remind blocked users once per 10 minutes to avoid burning Twilio credits
    if (shouldSendBlockReminder(from)) {
      await sendMessage(from, MSG.blocked(blockStatus.blockedUntil));
    }
    return;
  }

  // ── Get or create session ─────────────────────────────────────────────────
  let session = await getSession(from);

  // Restart keywords — only restart if user explicitly greets AND has no active session,
  // OR if they explicitly say 'restart'. This prevents a fresh Welcome message being
  // sent every time Render restarts the server and loses the in-memory session.
  const isExplicitRestart = /^(restart)$/i.test(input);
  const isGreeting        = /^(hi|hello|start|नमस्ते|हैलो)$/i.test(input);

  if (isExplicitRestart || (isGreeting && !session)) {
    if (session) await deleteSession(from);
    session = await createSession(from);
    const welcomeMsg = config.welcome_message || MSG.welcome(config.panchayat_name);
    await sendMessage(from, welcomeMsg);
    return;
  }

  // If no session and not a greeting, prompt them to start instead of silently failing
  if (!session) {
    await sendMessage(from, MSG.sessionExpired());
    return;
  }

  // ── Route based on current step ───────────────────────────────────────────
  try {
    switch (session.currentStep) {

      // ── STEP 0: Main Menu Selection ────────────────────────────────────────
      case STEPS.MAIN_MENU: {
        if (input === '1') {
          // Fetch blank application forms from database
          const { data: forms, error } = await supabaseAdmin
            .from('blank_forms')
            .select('*')
            .order('created_at', { ascending: false });

          if (error || !forms || forms.length === 0) {
            await sendMessage(from, '📭 No blank application forms are currently configured. Please try again later or contact the gram panchayat office.');
            await deleteSession(from);
            return;
          }

          // Transition to FORM_SELECT
          await updateSession(from, { currentStep: STEPS.FORM_SELECT });
          await sendMessage(from, MSG.formList(forms));
        } else if (input === '2') {
          // Start Retrieve Documents Flow
          await updateSession(from, { currentStep: STEPS.MOBILE });
          await sendMessage(from, 'To retrieve your personal documents, please share your *10-digit registered mobile number*.');
        } else if (input === '3') {
          // Start Pay Property Tax Flow
          await updateSession(from, { currentStep: STEPS.TAX_MOBILE });
          await sendMessage(from, 'To pay your property tax online, please share your *10-digit registered mobile number*.');
        } else {
          // Invalid choice in main menu
          await sendMessage(from, '❌ Invalid choice. Please reply with *1* (Forms), *2* (Documents), or *3* (Property Tax).');
        }
        break;
      }

      // ── STEP 0.5: Form Selection ─────────────────────────────────────────
      case STEPS.FORM_SELECT: {
        const { data: forms, error } = await supabaseAdmin
          .from('blank_forms')
          .select('*')
          .order('created_at', { ascending: false });

        if (error || !forms || forms.length === 0) {
          await sendMessage(from, '❌ Forms are temporarily unavailable. Please try again.');
          await deleteSession(from);
          return;
        }

        const choice = parseInt(input, 10);
        if (isNaN(choice) || choice < 1 || choice > forms.length) {
          await sendMessage(from, `❌ Invalid choice. Please reply with a number between *1* and *${forms.length}*.`);
          return;
        }

        const selectedForm = forms[choice - 1];
        await sendMessage(from, `⏳ Preparing your *${selectedForm.name}*... Please wait.`);

        // Log transaction inside Supabase audit logs
        await logTransaction({
          citizenId: null,
          whatsappNumber: from,
          documentRequested: `[Form Download] ${selectedForm.name}`,
          status: 'success',
          sessionId: session.id,
        });

        // Send PDF Form and description with required documents
        await sendMedia(
          from,
          MSG.formDelivery(selectedForm.name, selectedForm.required_documents),
          selectedForm.pdf_url
        );

        // Transition to FORM_CONFIRM
        await updateSession(from, { currentStep: STEPS.FORM_CONFIRM });
        break;
      }

      // ── STEP 0.6: Form Confirmation yes/no ────────────────────────────────
      case STEPS.FORM_CONFIRM: {
        const lower = input.toLowerCase();
        if (['yes', 'y', 'हाँ', 'ha'].includes(lower)) {
          // Restart to main menu
          await updateSession(from, { currentStep: STEPS.MAIN_MENU });
          const welcomeMsg = config.welcome_message || MSG.welcome(config.panchayat_name);
          await sendMessage(from, welcomeMsg);
        } else if (['no', 'n', 'नहीं', 'nahi'].includes(lower)) {
          await sendMessage(from, MSG.goodbye());
          await deleteSession(from);
        } else {
          await sendMessage(from, '❓ Please reply with *Yes* or *No*.');
        }
        break;
      }

      // ── STEP 0.7: Tax Mobile Lookup ──────────────────────────────────────
      case STEPS.TAX_MOBILE: {
        const validation = validateMobile(input);
        if (!validation.valid) {
          await sendMessage(from, MSG.invalidMobile());
          return;
        }

        // Search for a pending tax record matching this mobile number
        const { data: record, error } = await supabaseAdmin
          .from('tax_records')
          .select('*')
          .eq('mobile_number', validation.normalized)
          .eq('payment_status', 'pending')
          .limit(1)
          .single();

        if (error || !record) {
          await sendMessage(from, '🎉 Great news! You have no outstanding property tax dues for this mobile number.');
          
          // Loop back to main menu
          await updateSession(from, { currentStep: STEPS.MAIN_MENU });
          const welcomeMsg = config.welcome_message || MSG.welcome(config.panchayat_name);
          await sendMessage(from, welcomeMsg);
          return;
        }

        // Pending tax due found!
        await updateSession(from, {
          currentStep: STEPS.TAX_CONFIRM,
          _taxRecord: record // Temporary store in session memory
        });

        const taxPrompt = `📊 *Property Tax Outstanding Dues Found!*\n\n` +
                          `🏠 *Property ID:* ${record.property_id}\n` +
                          `👤 *Owner Name:* ${record.owner_name}\n` +
                          `💰 *Amount Due:* ₹${parseFloat(record.due_amount).toFixed(2)}\n\n` +
                          `Would you like to generate a payment link to pay online right now? (Reply *Yes* or *No*)`;

        await sendMessage(from, taxPrompt);
        break;
      }

      // ── STEP 0.8: Tax Confirmation yes/no ─────────────────────────────────
      case STEPS.TAX_CONFIRM: {
        const lower = input.toLowerCase();
        if (['yes', 'y', 'हाँ', 'ha'].includes(lower)) {
          const record = session._taxRecord;
          if (!record) {
            await sendMessage(from, '❌ Session mismatch. Please start again.');
            await deleteSession(from);
            return;
          }

          await sendMessage(from, '⏳ Generating secure Razorpay payment link... Please wait.');

          let paymentLink = record.payment_link;
          
          // Generate new payment link if missing
          if (!paymentLink) {
            const Razorpay = require('razorpay');
            if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
              try {
                const razorpay = new Razorpay({
                  key_id: process.env.RAZORPAY_KEY_ID,
                  key_secret: process.env.RAZORPAY_KEY_SECRET
                });

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

                // Update in DB
                await supabaseAdmin
                  .from('tax_records')
                  .update({
                    razorpay_payment_link_id: linkData.id,
                    payment_link: paymentLink
                  })
                  .eq('id', record.id);

              } catch (rzpErr) {
                console.error('[Razorpay] Bot link generation failed:', rzpErr.message);
              }
            }
          }

          // Fallback to mock link if Razorpay creation failed or wasn't configured
          if (!paymentLink) {
            paymentLink = `https://rzp.io/i/mock_tax_${record.id.substring(0, 8)}`;
            await supabaseAdmin
              .from('tax_records')
              .update({ payment_link: paymentLink })
              .eq('id', record.id);
          }

          const responseMsg = `💳 *Secure Razorpay Link Generated!* \n\n` +
                              `Click here to complete payment:\n🔗 ${paymentLink}\n\n` +
                              `Once the payment is verified, your official receipt will be delivered instantly on this chat.\n\n` +
                              `Need anything else? Reply *Yes* or *No*`;
          
          await sendMessage(from, responseMsg);
          await updateSession(from, { currentStep: STEPS.FORM_CONFIRM }); // Re-use general Yes/No menu loop

        } else if (['no', 'n', 'नहीं', 'nahi'].includes(lower)) {
          // Loop back to main menu
          await updateSession(from, { currentStep: STEPS.MAIN_MENU });
          const welcomeMsg = config.welcome_message || MSG.welcome(config.panchayat_name);
          await sendMessage(from, welcomeMsg);
        } else {
          await sendMessage(from, '❓ Please reply with *Yes* or *No*.');
        }
        break;
      }

      // ── STEP 1: Mobile Number ───────────────────────────────────────────
      case STEPS.MOBILE: {
        const validation = validateMobile(input);
        if (!validation.valid) {
          await sendMessage(from, MSG.invalidMobile());
          return;
        }

        const { valid, citizen } = await verifyMobile(validation.normalized);
        if (!valid) {
          await sendMessage(from, MSG.mobileNotFound(config.office_phone, config.office_hours));
          await deleteSession(from);
          return;
        }

        // Store citizen data in session (not full Aadhaar)
        await updateSession(from, {
          currentStep: STEPS.NAME,
          mobileNumber: validation.normalized,
          citizenId: citizen.id,
          _citizenName: citizen.full_name,       // temp, not persisted to DB
          _citizenDob: citizen.date_of_birth,
          _aadhaarEncrypted: citizen.aadhaar_number_encrypted,
          _aadhaarLast4: citizen.aadhaar_last4,
          retryCount: 0,
        });

        await sendMessage(from, MSG.askName());
        break;
      }

      // ── STEP 2: Full Name ───────────────────────────────────────────────
      case STEPS.NAME: {
        const validation = validateName(input);
        if (!validation.valid) {
          await sendMessage(from, validation.error);
          return;
        }

        const { valid } = verifyName(validation.normalized, session._citizenName);
        if (!valid) {
          const newRetry = (session.retryCount || 0) + 1;
          const { blocked, remaining } = await recordFailedAttempt(from, 'name', newRetry - 1);

          if (blocked) {
            await sendMessage(from, MSG.blocked(new Date(Date.now() + parseInt(config.block_duration_minutes || '30') * 60000)));
            await deleteSession(from);
            return;
          }

          await updateSession(from, { retryCount: newRetry });
          await sendMessage(from, MSG.nameRetry(remaining));
          return;
        }

        await updateSession(from, { currentStep: STEPS.AADHAAR, retryCount: 0 });
        await sendMessage(from, MSG.askAadhaar());
        break;
      }

      // ── STEP 3: Aadhaar ─────────────────────────────────────────────────
      case STEPS.AADHAAR: {
        const validation = validateAadhaar(input);
        if (!validation.valid) {
          await sendMessage(from, validation.error);
          return;
        }

        // Compare the 4-digit input directly against stored aadhaar_last4
        const { valid } = {
          valid: validation.normalized === session._aadhaarLast4
        };

        if (!valid) {
          const newRetry = (session.retryCount || 0) + 1;
          const { blocked, remaining } = await recordFailedAttempt(from, 'aadhaar', newRetry - 1);

          if (blocked) {
            await sendMessage(from, MSG.blocked(new Date(Date.now() + parseInt(config.block_duration_minutes || '30') * 60000)));
            await deleteSession(from);
            return;
          }

          await updateSession(from, { retryCount: newRetry });
          await sendMessage(from, MSG.aadhaarRetry(remaining));
          return;
        }

        // ✅ All 3 steps verified — fetch documents
        const folderIdOrMobile = session.mobileNumber;
        let docs = [];
        try {
          docs = await listDocuments(folderIdOrMobile);
        } catch (err) {
          await sendMessage(from, MSG.genericError());
          return;
        }

        if (docs.length === 0) {
          await sendMessage(from, '📭 No documents found for your account. Please contact the gram panchayat office.');
          await deleteSession(from);
          return;
        }

        await updateSession(from, {
          currentStep: STEPS.DOCUMENT_SELECT,
          documentList: docs,
          retryCount: 0,
        });

        await sendMessage(from, MSG.documentList(docs));
        break;
      }

      // ── STEP 4: Document Selection ───────────────────────────────────────
      case STEPS.DOCUMENT_SELECT: {
        const docs = session.documentList || [];
        const validation = validateDocumentChoice(input, docs.length);

        if (!validation.valid) {
          await sendMessage(from, MSG.invalidChoice(docs.length));
          return;
        }

        const selectedDoc = docs[validation.choice - 1];
        await updateSession(from, { currentStep: STEPS.DELIVERY });

        // Send processing notice
        await sendMessage(from, `⏳ Preparing your *${selectedDoc.label}*... Please wait.`);

        try {
          // Download + protect PDF
          const pdfBuffer    = await downloadDocument(session.mobileNumber, selectedDoc.id);
          const dob          = session._citizenDob;
          const password     = dobToPassword(dob);
          const protectedPdf = await protectPDF(pdfBuffer, password, selectedDoc.label);

          // Save and get public URL (works with Ngrok)
          const { mediaUrl } = await savePDFForDelivery(protectedPdf, selectedDoc.label);

          // Log transaction
          await logTransaction({
            citizenId: session.citizenId,
            whatsappNumber: from,
            documentRequested: `[Doc Retrieval] ${selectedDoc.label}`,
            status: 'success',
            sessionId: session.id,
          });

          if (mediaUrl) {
            // ✅ Send the actual PDF via Twilio
            await sendMedia(
              from,
              `📄 Your *${selectedDoc.label}* is ready!\n\n` +
              `🔒 *PDF Password:* Your date of birth in DDMMYYYY format\n` +
              `_Example: 15th March 1990 → 15031990_\n\n` +
              `Need another document? Reply *Yes* or *No*`,
              mediaUrl
            );
          } else {
            // No public URL — send password instructions only
            await sendMessage(from,
              `✅ *${selectedDoc.label}* has been processed!\n\n` +
              `🔒 *PDF Password:* Your date of birth in DDMMYYYY format\n` +
              `_Example: 15th March 1990 → 15031990_\n\n` +
              `⚠️ To receive the actual PDF file, add PUBLIC_URL to your .env file\n` +
              `(set it to your Ngrok URL, e.g. https://xxxx.ngrok-free.dev)\n\n` +
              `Need another document? Reply *Yes* or *No*`
            );
          }

          await updateSession(from, { currentStep: STEPS.DOCUMENT_CONFIRM });
        } catch (err) {
          console.error('[Flow] Document delivery error:', err.message);
          await logTransaction({
            citizenId: session.citizenId,
            whatsappNumber: from,
            documentRequested: `[Doc Retrieval] ${selectedDoc.label}`,
            status: 'failed',
            failureReason: err.message,
            sessionId: session.id,
          });
          await sendMessage(from, `❌ Unable to process your document. Our team has been notified.\n\nNeed another document? Reply *Yes* or *No*`);
          await updateSession(from, { currentStep: STEPS.DOCUMENT_CONFIRM });
        }
        break;
      }

      // ── STEP 5: Document Confirmation yes/no ────────────────────────────────
      case STEPS.DOCUMENT_CONFIRM: {
        const lower = input.toLowerCase();
        if (['yes', 'y', 'हाँ', 'ha'].includes(lower)) {
          const docs = session.documentList || [];
          await updateSession(from, { currentStep: STEPS.DOCUMENT_SELECT });
          await sendMessage(from, MSG.documentList(docs));
        } else if (['no', 'n', 'नहीं', 'nahi'].includes(lower)) {
          await sendMessage(from, MSG.goodbye());
          await deleteSession(from);
        } else {
          await sendMessage(from, '❓ Please reply with *Yes* or *No*.');
        }
        break;
      }

      default: {
        await sendMessage(from, MSG.invalidInput());
        break;
      }
    }
  } catch (err) {
    console.error('[Flow] Unhandled error:', err.message, err.stack);
    await sendMessage(from, MSG.genericError()).catch(() => {});
  }
}

module.exports = { handleMessage };
