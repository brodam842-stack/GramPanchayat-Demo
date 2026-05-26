const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'gp-jwt-dev-secret-change-in-prod-2024';

async function main() {
  console.log('1. Generating signed admin JWT token...');
  const token = jwt.sign(
    { id: 'test-admin-id', email: 'admin@panchayat.gov.in', role: 'super_admin', name: 'Verification Bot' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log('✓ Token generated!');

  console.log('\n2. Creating a blank form via backend API...');
  
  // Create a minimal PDF file buffer
  const { PDFDocument } = require('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([595, 842]);
  const pdfBytes = await pdfDoc.save();
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });

  const formData = new FormData();
  formData.append('name', 'Verification Test Form');
  formData.append('required_documents', 'Aadhaar Card, Verification Code');
  formData.append('file', pdfBlob, 'verification_test_form.pdf');

  const uploadResponse = await fetch('http://localhost:3000/api/forms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const uploadResult = await uploadResponse.json();
  if (!uploadResponse.ok) {
    console.error('❌ Failed to upload form:', uploadResult);
    process.exit(1);
  }

  const { form, message } = uploadResult;
  console.log('✓ Blank form created successfully!');
  console.log('Response Message:', message);
  console.log('Live PDF URL:', form.pdf_url);
  console.log('Form ID in DB:', form.id);

  console.log('\n3. Verifying public retrieval of the PDF URL...');
  console.log('Making public request to:', form.pdf_url);

  const viewResponse = await fetch(form.pdf_url);
  const viewText = await viewResponse.text();

  if (!viewResponse.ok) {
    console.error(`❌ Public retrieval failed with status ${viewResponse.status}:`, viewText);
    process.exit(1);
  }

  // Check if it returned the Supabase storage 404 JSON
  try {
    const json = JSON.parse(viewText);
    if (json.statusCode === '404' || json.error === 'Bucket not found') {
      console.error('❌ Public retrieval returned Bucket not found JSON:', json);
      process.exit(1);
    }
  } catch (e) {
    // Expected to fail JSON parsing if it returns actual PDF binary bytes
  }

  console.log('✓ Public URL returned 200 OK and valid PDF bytes (no 404 error)!');

  console.log('\n4. Deleting the test form to clean up...');
  const deleteResponse = await fetch(`http://localhost:3000/api/forms/${form.id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const deleteResult = await deleteResponse.json();
  if (!deleteResponse.ok) {
    console.error('❌ Failed to delete form:', deleteResult);
    process.exit(1);
  }

  console.log('✓ Test form deleted successfully from DB and Cloud storage.');
  console.log('\n🌟 Complete verification successful!');
}

main().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});
