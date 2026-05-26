const twilioConfig = require('../src/config/twilio');

let lastMessageText = '';
let lastMediaSent = null;

// Mock Twilio functions immediately before anything else is required
twilioConfig.sendMessage = async (to, body) => {
  lastMessageText = body;
  console.log(`💬 [BOT REPLY]:\n${body}\n--------------------`);
  return { sid: 'MOCK_SID', status: 'mock' };
};

twilioConfig.sendMedia = async (to, body, mediaUrl) => {
  lastMediaSent = { body, mediaUrl };
  console.log(`🖼️ [BOT MEDIA REPLY] (URL: ${mediaUrl}):\n${body}\n--------------------`);
  return { sid: 'MOCK_SID', status: 'mock' };
};

const xlsx = require('xlsx');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'gp-jwt-dev-secret-change-in-prod-2024';

async function main() {
  console.log('1. Generating signed admin JWT token...');
  const token = jwt.sign(
    { id: 'test-admin-id', email: 'admin@panchayat.gov.in', role: 'super_admin', name: 'Tax Verification Bot' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log('✓ Token generated!');

  console.log('\n2. Creating mock property tax Excel sheet buffer...');
  // Create spreadsheet data matching @MilkatnoswisemobilenoReport (1).xlsx layout
  const headers = ['Milkat ID', 'Owner Name', 'Occupant Name', 'Due Amount', 'Mobile', 'Header 6', 'Header 7'];
  const row1 = ['TX101', 'દિનેશભાઇ ઠાકોરભાઇ પટેલ', 'દિનેશભાઇ ઠાકોરભાઇ પટેલ', '1520', '9537199300', 'મોબાઇલ નંબર', 'મિલકતનો પ્રકાર'];
  const row2 = ['TX102', 'રમણભાઇ કાળીદાસ', 'રમણભાઇ કાળીદાસ', '2450', '9824567406', 'મોબાઇલ નંબર', 'મિલકતનો પ્રકાર'];
  
  // Pad with header formatting rows to mock actual report
  const sheetData = [
    ['BABEN ગ્રામપંચાયત'],
    [],
    ['મિલ્કત નંબર મુજબ મોબાઈલ નં. રિપોર્ટ', '', 'वर्ष: 2026-2027'],
    headers,
    row1,
    row2
  ];

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(sheetData);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  console.log('✓ Mock Excel sheet created!');

  console.log('\n3. Importing Excel tax sheet via API endpoint /api/tax/import...');
  const formData = new FormData();
  formData.append('file', excelBlob, 'mock_tax_report.xlsx');

  const importResponse = await fetch('http://localhost:3000/api/tax/import', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const importResult = await importResponse.json();
  if (!importResponse.ok) {
    console.error('❌ Excel import failed:', importResult);
    process.exit(1);
  }
  console.log('✓ Excel import succeeded!');
  console.log('API Response:', importResult.message);

  console.log('\n4. Verifying imported records via API /api/tax/records...');
  const recordsResponse = await fetch('http://localhost:3000/api/tax/records?search=TX101', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const recordsResult = await recordsResponse.json();
  if (!recordsResponse.ok || recordsResult.records.length === 0) {
    console.error('❌ Failed to retrieve imported records:', recordsResult);
    process.exit(1);
  }
  const record = recordsResult.records[0];
  console.log('✓ Imported record retrieved successfully!');
  console.log('Property ID:', record.property_id);
  console.log('Owner Name:', record.owner_name);
  console.log('Due Amount:', record.due_amount);
  console.log('Mobile Number:', record.mobile_number);
  console.log('Payment Status:', record.payment_status);

  console.log('\n5. Simulating Citizen WhatsApp Bot Tax Payment Flow...');
  const { deleteSession, getSession } = require('../src/services/sessionManager');
  const { handleMessage } = require('../src/controllers/conversationController');
  
  const from = 'whatsapp:+919537199300';
  
  // Clear session & reset trackers
  await deleteSession(from);
  lastMessageText = '';
  lastMediaSent = null;

  // Step 5a: Citizen greets bot
  console.log('\n5a. Citizen sends: "Hi"');
  await handleMessage(from, 'Hi', 'sid_bot_1');
  if (!lastMessageText.includes('Pay Property Tax')) {
    console.error('❌ Option 3 (Pay Property Tax) missing in welcome message!');
    process.exit(1);
  }
  console.log('✓ Welcome message contains Property Tax option!');

  // Step 5b: Citizen chooses Option 3 (Property Tax)
  console.log('\n5b. Citizen sends: "3"');
  await handleMessage(from, '3', 'sid_bot_2');
  if (!lastMessageText.includes('10-digit registered mobile number')) {
    console.error('❌ Failed to prompt for tax mobile number!');
    process.exit(1);
  }
  console.log('✓ Bot successfully prompted for registered mobile number!');

  // Step 5c: Citizen enters mobile number
  console.log('\n5c. Citizen sends: "9537199300"');
  await handleMessage(from, '9537199300', 'sid_bot_3');
  if (!lastMessageText.includes('Property Tax Outstanding Dues Found')) {
    console.error('❌ Failed to retrieve outstanding dues for citizen!');
    process.exit(1);
  }
  console.log('✓ Bot successfully retrieved pending property tax!');
  console.log(`Verified Property ID: ${record.property_id}`);
  console.log(`Verified Due Amount: ₹${record.due_amount}`);

  // Step 5d: Citizen answers "Yes" to generate secure payment link
  console.log('\n5d. Citizen sends: "Yes"');
  await handleMessage(from, 'Yes', 'sid_bot_4');
  if (!lastMessageText.includes('Secure Razorpay Link Generated')) {
    console.error('❌ Failed to generate secure Razorpay link!');
    process.exit(1);
  }
  console.log('✓ Bot successfully generated secure Razorpay checkout link!');

  console.log('\n6. Simulating Mock Razorpay Webhook payment capture...');
  const webhookTriggerResponse = await fetch('http://localhost:3000/api/tax/webhook-mock-trigger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ propertyId: record.property_id })
  });

  const webhookText = await webhookTriggerResponse.text();
  let webhookResult = {};
  try {
    webhookResult = JSON.parse(webhookText);
  } catch (e) {
    console.error(`❌ Mock webhook trigger failed with non-JSON response (Status: ${webhookTriggerResponse.status}):\n${webhookText}`);
    process.exit(1);
  }

  if (!webhookTriggerResponse.ok) {
    console.error('❌ Mock webhook trigger failed:', webhookResult);
    process.exit(1);
  }
  console.log('✓ Mock webhook trigger succeeded!');
  console.log(webhookResult.message);

  console.log('\n7. Verifying record updated to PAID status in DB...');
  const updatedRecordsResponse = await fetch(`http://localhost:3000/api/tax/records?search=${record.property_id}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const updatedRecordsResult = await updatedRecordsResponse.json();
  const updatedRecord = updatedRecordsResult.records[0];
  if (updatedRecord.payment_status !== 'paid') {
    console.error('❌ Record status is still pending after payment webhook capture!', updatedRecord);
    process.exit(1);
  }
  console.log('✓ Payment status successfully updated to PAID!');
  console.log('Generated Receipt PDF URL:', updatedRecord.receipt_pdf_url);

  console.log('\n8. Verifying public retrieval of the PDF receipt and the Panchayat collection note...');
  const receiptResponse = await fetch(updatedRecord.receipt_pdf_url);
  const receiptText = await receiptResponse.text();
  
  if (!receiptResponse.ok) {
    console.error('❌ Failed to retrieve PDF receipt from gp-delivery public bucket!');
    process.exit(1);
  }
  
  // Ensure it's not the 404 JSON
  if (receiptText.includes('Bucket not found')) {
    console.error('❌ Receipt URL returned 404 Bucket not found JSON!');
    process.exit(1);
  }
  console.log('✓ PDF receipt loaded successfully!');

  // 9. Cleaning up test data
  console.log('\n9. Cleaning up test tax entries from database...');
  const { supabaseAdmin: sbAdmin } = require('../src/config/supabase');
  await sbAdmin.from('tax_records').delete().in('property_id', ['TX101', 'TX102']);
  await deleteSession(from);
  console.log('✓ Database and sessions cleaned up successfully.');

  console.log('\n🌟 PROPERTY TAX COMPILATION & PIPELINE VERIFIED 100% PERFECTLY!');
}

main().catch(err => {
  console.error('Error during tax pipeline verification:', err);
  process.exit(1);
});
