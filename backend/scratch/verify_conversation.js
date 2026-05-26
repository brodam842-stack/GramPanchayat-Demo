const twilioConfig = require('../src/config/twilio');
const { deleteSession, getSession } = require('../src/services/sessionManager');

let lastSentMessage = null;
let lastSentMedia = null;

// Mock Twilio functions to capture the outgoing messages
twilioConfig.sendMessage = async (to, body) => {
  console.log(`💬 [BOT REPLY]:\n${body}\n----------------------------------------`);
  lastSentMessage = body;
  return { sid: 'MOCK_SID', status: 'mock' };
};

twilioConfig.sendMedia = async (to, body, mediaUrl) => {
  console.log(`🖼️ [BOT MEDIA REPLY] (URL: ${mediaUrl}):\n${body}\n----------------------------------------`);
  lastSentMedia = { body, mediaUrl };
  return { sid: 'MOCK_SID', status: 'mock' };
};

const { handleMessage } = require('../src/controllers/conversationController');

async function assertContains(text, pattern, name) {
  if (!text.toLowerCase().includes(pattern.toLowerCase())) {
    console.error(`❌ Assertion failed for ${name}! Expected text to contain "${pattern}", but got:\n${text}`);
    process.exit(1);
  }
  console.log(`✓ Passed: ${name}`);
}

async function main() {
  const from = 'whatsapp:+919876543210';
  
  console.log('Clearing any existing session for test user...');
  await deleteSession(from);

  console.log('\n--- START SIMULATED CONVERSATION ---');

  // 1. Citizen sends "Hi"
  console.log('\n1. Citizen sends: "Hi"');
  await handleMessage(from, 'Hi', 'sid_1');
  await assertContains(lastSentMessage, 'Download Blank Application Forms', 'Greeting message options');
  await assertContains(lastSentMessage, 'Retrieve Personal Documents', 'Greeting message options');

  // 2. Citizen chooses option 2 (Personal documents)
  console.log('\n2. Citizen sends: "2"');
  await handleMessage(from, '2', 'sid_2');
  await assertContains(lastSentMessage, 'registered mobile number', 'Mobile number prompt');

  // 3. Citizen inputs mobile number
  console.log('\n3. Citizen sends: "9876543210"');
  await handleMessage(from, '9876543210', 'sid_3');
  await assertContains(lastSentMessage, 'full name', 'Full name prompt');

  // 4. Citizen inputs name
  console.log('\n4. Citizen sends: "Ramesh Kumar Verma"');
  await handleMessage(from, 'Ramesh Kumar Verma', 'sid_4');
  await assertContains(lastSentMessage, 'digits* of your Aadhaar', 'Aadhaar digits prompt');

  // 5. Citizen inputs Aadhaar last 4
  console.log('\n5. Citizen sends: "9012"');
  await handleMessage(from, '9012', 'sid_5');
  await assertContains(lastSentMessage, 'Identity verified successfully', 'Identity verification success');
  await assertContains(lastSentMessage, 'Domicile Certificate', 'Document list showing Domicile Certificate');

  // 6. Citizen selects document 1 (Domicile Certificate)
  console.log('\n6. Citizen sends: "1"');
  // Capture what is sent via sendMedia
  lastSentMedia = null;
  await handleMessage(from, '1', 'sid_6');
  
  if (!lastSentMedia) {
    console.error('❌ Failed: Expected a media message containing the PDF document!');
    process.exit(1);
  }
  console.log('✓ Passed: PDF document delivered successfully!');
  await assertContains(lastSentMedia.body, 'Your *Domicile Certificate* is ready', 'Document delivery message');
  await assertContains(lastSentMedia.body, 'Need another document? Reply *Yes* or *No*', 'Another document prompt');

  // 7. Citizen replies "No" to end conversation
  console.log('\n7. Citizen sends: "No"');
  await handleMessage(from, 'No', 'sid_7');
  await assertContains(lastSentMessage, 'Thank you for using our service', 'Goodbye message');

  // 8. Verify session has been deleted
  const finalSession = await getSession(from);
  if (finalSession !== null) {
    console.error('❌ Failed: Session was not deleted after saying "No"!');
    process.exit(1);
  }
  console.log('✓ Passed: Session successfully deleted and cleaned up!');

  console.log('\n🌟 CONVERSATION FLOW VERIFIED 100% PERFECTLY!');
}

main().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});
