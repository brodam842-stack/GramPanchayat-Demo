const twilioConfig = require('../src/config/twilio');

let lastMessageText = '';
let lastMediaSent = null;

// Mock Twilio functions
twilioConfig.sendMessage = async (to, body) => {
  lastMessageText = body;
  console.log(`💬 [BOT REPLY to ${to}]:\n${body}\n--------------------`);
  return { sid: 'MOCK_SID_NEW', status: 'mock' };
};

twilioConfig.sendMedia = async (to, body, mediaUrl) => {
  lastMediaSent = { body, mediaUrl };
  console.log(`🖼️ [BOT MEDIA REPLY to ${to}] (URL: ${mediaUrl}):\n${body}\n--------------------`);
  return { sid: 'MOCK_SID_NEW', status: 'mock' };
};

const xlsx = require('xlsx');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'gp-jwt-dev-secret-change-in-prod-2024';

async function main() {
  console.log('--- GRAM PANCHAYAT ENHANCEMENTS VERIFICATION ---');
  
  console.log('\n1. Generating admin JWT credentials...');
  const token = jwt.sign(
    { id: 'test-admin-id', email: 'admin@panchayat.gov.in', role: 'super_admin', name: 'Verification Engine' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log('✓ Admin token generated!');

  console.log('\n2. Testing Phase 3: Bulk Message spreadsheet contacts ingestion /api/broadcast/import-recipients...');
  // Create spreadsheet data matching Sr. No | Name | Mobile No. |
  const broadcastHeaders = ['sr. No.', 'Name', 'Mobile No.'];
  const contact1 = ['1', 'Dinesh Patel', '9537199300'];
  const contact2 = ['2', 'Raman Kalidas', '9824567406'];
  const contact3 = ['3', 'Invalid Mobile', '12345']; // should be skipped by filter
  
  const broadcastSheetData = [
    broadcastHeaders,
    contact1,
    contact2,
    contact3
  ];

  const wb1 = xlsx.utils.book_new();
  const ws1 = xlsx.utils.aoa_to_sheet(broadcastSheetData);
  xlsx.utils.book_append_sheet(wb1, ws1, 'Contacts');
  const excelBuffer1 = xlsx.write(wb1, { type: 'buffer', bookType: 'xlsx' });
  const excelBlob1 = new Blob([excelBuffer1], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const formData1 = new FormData();
  formData1.append('file', excelBlob1, 'broadcast_contacts.xlsx');

  const importContactsResponse = await fetch('http://localhost:3000/api/broadcast/import-recipients', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData1
  });

  const importContactsResult = await importContactsResponse.json();
  if (!importContactsResponse.ok) {
    console.error('❌ Ingestion of bulk recipients spreadsheet failed:', importContactsResult);
    process.exit(1);
  }
  console.log('✓ Bulk recipients spreadsheet parsed successfully!');
  console.log('API Message:', importContactsResult.message);
  console.log('Parsed Contacts:', importContactsResult.contacts);
  
  if (importContactsResult.contacts.length !== 2) {
    console.error('❌ Expected exactly 2 valid contacts (contact3 has invalid mobile and should be skipped)!');
    process.exit(1);
  }
  console.log('✓ Mobile validation filter verified!');

  console.log('\n3. Testing Phase 3: Bulk Broadcast send endpoint with imported contacts...');
  const broadcastSendResponse = await fetch('http://localhost:3000/api/broadcast/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      message: 'Hello {name}, this is a bulk test broadcast!',
      recipients: {
        type: 'imported',
        contacts: importContactsResult.contacts
      }
    })
  });

  const broadcastSendResult = await broadcastSendResponse.json();
  if (!broadcastSendResponse.ok) {
    console.error('❌ Broadcast delivery failed:', broadcastSendResult);
    process.exit(1);
  }
  console.log('✓ Bulk broadcast sent successfully to imported contacts!');
  console.log('API Report:', broadcastSendResult.message);

  console.log('\n4. Testing Phase 1: Duplicate Tax Ingestion Checking...');
  // Let's manually clear any old records first
  const { supabaseAdmin } = require('../src/config/supabase');
  await supabaseAdmin.from('tax_records').delete().in('property_id', ['DUP101', 'DUP102']);

  // Insert a record with mobile '9000000001' beforehand to test duplicate checking
  const preInsertResult = await supabaseAdmin.from('tax_records').insert({
    property_id: 'DUP101',
    owner_name: 'Existing Owner',
    due_amount: 1200.00,
    mobile_number: '9000000001',
    payment_status: 'pending'
  });

  // Now create mock Excel sheet with 2 rows: one overlapping mobile '9000000001', one new mobile '9000000002'
  const taxHeaders = ['Milkat ID', 'Owner Name', 'Occupant Name', 'Due Amount', 'Mobile', 'Header 6', 'Header 7'];
  const taxRow1 = ['DUP101', 'Existing Owner', 'Existing Owner', '1200', '9000000001', 'મોબાઇલ નંબર', 'મિલકતનો પ્રકાર']; // DUPLICATE
  const taxRow2 = ['DUP102', 'Dinesh Patel New', 'Dinesh Patel New', '1520', '9000000002', 'મોબાઇલ નંબર', 'મિલકતનો પ્રકાર']; // UNIQUE
  
  const taxSheetData = [
    ['PANCHAYAT REPORT'],
    [],
    ['મિલ્કત નંબર મુજબ મોબાઈલ નં. રિપોર્ટ', '', 'वर्ष: 2026-2027'],
    taxHeaders,
    taxRow1,
    taxRow2
  ];

  const wb2 = xlsx.utils.book_new();
  const ws2 = xlsx.utils.aoa_to_sheet(taxSheetData);
  xlsx.utils.book_append_sheet(wb2, ws2, 'Sheet1');
  const excelBuffer2 = xlsx.write(wb2, { type: 'buffer', bookType: 'xlsx' });
  const excelBlob2 = new Blob([excelBuffer2], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const formData2 = new FormData();
  formData2.append('file', excelBlob2, 'tax_duplicate_report.xlsx');

  const taxImportResponse = await fetch('http://localhost:3000/api/tax/import', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData2
  });

  const taxImportResult = await taxImportResponse.json();
  if (!taxImportResponse.ok) {
    console.error('❌ Tax import failed:', taxImportResult);
    process.exit(1);
  }
  console.log('✓ Tax duplicate checking spreadsheet ingested successfully!');
  console.log('Import Statistics:', taxImportResult);
  
  if (taxImportResult.duplicates !== 1 || taxImportResult.imported !== 1) {
    console.error('❌ Expected exactly 1 duplicate skipped and 1 unique record imported!');
    process.exit(1);
  }
  console.log('✓ Duplicate check successfully skipped DUP101 (9000000001) and imported DUP102 (9000000002)!');

  console.log('\n5. Testing Phase 2: Individual WhatsApp Dues Alert...');
  // Fetch the imported DUP102 record to get its ID
  const recordResponse = await fetch('http://localhost:3000/api/tax/records?search=DUP102', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const recordResult = await recordResponse.json();
  const targetRecord = recordResult.records[0];
  
  console.log(`Sending individual dues alert for Record ID: ${targetRecord.id} (Owner: ${targetRecord.owner_name})...`);
  const individualAlertResponse = await fetch(`http://localhost:3000/api/tax/record/${targetRecord.id}/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      template: 'Hi {owner_name}, Property tax due for ID: {property_id} is ₹{due_amount}. Pay now: {payment_link}'
    })
  });

  const individualAlertResult = await individualAlertResponse.json();
  if (!individualAlertResponse.ok) {
    console.error('❌ Individual notification dispatch failed:', individualAlertResult);
    process.exit(1);
  }
  console.log('✓ Individual dues alert sent successfully!');
  console.log('API Message:', individualAlertResult.message);
  console.log('Sent text snippet:', lastMessageText.slice(0, 80) + '...');

  console.log('\n6. Testing Phase 4: Categorized Audit Logging...');
  // Fetch the last few transactions from audit logs
  const auditResponse = await fetch('http://localhost:3000/api/analytics/transactions?limit=30', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const auditResult = await auditResponse.json();
  if (!auditResponse.ok) {
    console.error('❌ Failed to retrieve audit logs:', auditResult);
    process.exit(1);
  }
  console.log('✓ Audit transaction logs loaded successfully!');
  console.log('Audit API Result:', JSON.stringify(auditResult, null, 2));
  
  const txns = auditResult.transactions || [];
  console.log('Recent transaction logs:');
  txns.forEach((t, i) => {
    console.log(`[${i + 1}] Number: ${t.whatsapp_number} | Document/Category: ${t.document_requested} | Status: ${t.delivery_status}`);
  });

  const foundBroadcast = txns.some(t => t.document_requested.includes('[Broadcast]'));
  const foundIndividualAlert = txns.some(t => t.document_requested.includes('[Tax Alert]'));

  if (!foundBroadcast) {
    console.error('❌ Missing categorized [Broadcast] log!');
    process.exit(1);
  }
  if (!foundIndividualAlert) {
    console.error('❌ Missing categorized [Tax Alert] log!');
    process.exit(1);
  }

  console.log('✓ Audit classifications verified perfectly!');

  // Cleanup
  console.log('\n7. Cleaning up test tax entries...');
  await supabaseAdmin.from('tax_records').delete().in('property_id', ['DUP101', 'DUP102']);
  console.log('✓ Database cleaned up successfully.');

  console.log('\n🌟 ALL 4 ENHANCEMENTS AND RETRIEVAL AUDITS VERIFIED 100% PERFECTLY!');
}

main().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});
