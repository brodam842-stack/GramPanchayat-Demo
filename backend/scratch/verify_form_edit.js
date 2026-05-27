const axios = require('axios');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../src/config/supabase');

const API_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'gram_panchayat_secure_key_123';

// 1. Generate an admin token for authentication
function generateAdminToken() {
  return jwt.sign(
    { id: 'admin-test-id', username: 'admin', role: 'super_admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function run() {
  console.log('=== VERIFY BLANK FORM EDITING ROUTE ===');
  
  const token = generateAdminToken();
  const authHeaders = { Authorization: `Bearer ${token}` };
  
  // 2. Setup temporary mock form record directly in DB
  console.log('\nCreating a temporary mock form in Supabase...');
  const crypto = require('crypto');
  const tempFormId = crypto.randomUUID();
  const initialPdfPath = `forms/initial_test_${Date.now()}.pdf`;
  const initialPdfUrl = `https://lnxikzsnpxkacphxwqri.supabase.co/storage/v1/object/public/gp-delivery/${initialPdfPath}`;
  
  // Upload a dummy file to Supabase storage first so we can test replacement deletion
  const dummyBuffer = Buffer.from('%PDF-1.4 ... dummy content ...');
  const { error: storageErr } = await supabaseAdmin.storage
    .from('gp-delivery')
    .upload(initialPdfPath, dummyBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });
    
  if (storageErr) {
    console.error('Failed to upload dummy test file to storage:', storageErr);
    process.exit(1);
  }
  console.log(`✓ Dummy PDF uploaded to storage: ${initialPdfPath}`);

  const { data: initialForm, error: insertErr } = await supabaseAdmin
    .from('blank_forms')
    .insert({
      id: tempFormId,
      name: 'Temp Initial Form',
      required_documents: 'Aadhaar Card\nIncome Certificate',
      pdf_url: initialPdfUrl
    })
    .select()
    .single();

  if (insertErr) {
    console.error('Failed to insert test form in blank_forms table:', insertErr);
    process.exit(1);
  }
  console.log('✓ Temporary form inserted in blank_forms table:', initialForm);

  try {
    // 3. Test Metadata-only update (No PDF replacement)
    console.log('\nTesting metadata-only update (PUT /api/forms/:id)...');
    
    // We use Form Data since the endpoint expects multer forms
    const FormData = require('form-data');
    const metaFormData = new FormData();
    metaFormData.append('name', 'Temp Updated Form Name');
    metaFormData.append('required_documents', 'Aadhaar Card\nUpdated Passport Copy');

    const metaRes = await axios.put(`${API_URL}/api/forms/${tempFormId}`, metaFormData, {
      headers: {
        ...authHeaders,
        ...metaFormData.getHeaders()
      }
    });

    console.log('✓ Metadata-only update response:', metaRes.data);
    if (metaRes.data.form.name !== 'Temp Updated Form Name' || metaRes.data.form.pdf_url !== initialPdfUrl) {
      throw new Error('Metadata was not updated correctly, or PDF url was modified incorrectly!');
    }
    console.log('✓ Metadata-only update verified perfectly!');

    // 4. Test PDF Replacement update
    console.log('\nTesting PDF replacement update (PUT /api/forms/:id)...');
    
    const replacementFormData = new FormData();
    replacementFormData.append('name', 'Temp Form Fully Updated');
    replacementFormData.append('required_documents', 'Aadhaar Card\nUpdated Passport Copy\nProof of Address');
    
    // Create a new mock PDF to upload
    const mockFilePath = path.join(__dirname, 'mock_replacement.pdf');
    fs.writeFileSync(mockFilePath, '%PDF-1.5 ... replacement content ...');
    
    replacementFormData.append('file', fs.createReadStream(mockFilePath), {
      filename: 'mock_replacement.pdf',
      contentType: 'application/pdf'
    });

    const replaceRes = await axios.put(`${API_URL}/api/forms/${tempFormId}`, replacementFormData, {
      headers: {
        ...authHeaders,
        ...replacementFormData.getHeaders()
      }
    });

    console.log('✓ PDF replacement update response:', replaceRes.data);
    const newPdfUrl = replaceRes.data.form.pdf_url;
    console.log('✓ New PDF URL:', newPdfUrl);

    if (newPdfUrl === initialPdfUrl) {
      throw new Error('PDF url was not updated after uploading a new file!');
    }

    // Clean up local mock file
    if (fs.existsSync(mockFilePath)) {
      fs.unlinkSync(mockFilePath);
    }

    // 5. Verify the old PDF was deleted from storage to avoid orphaned files
    console.log('\nVerifying old PDF was deleted from storage...');
    const { data: oldFileExists, error: listErr } = await supabaseAdmin.storage
      .from('gp-delivery')
      .list('forms', { search: path.basename(initialPdfPath) });

    if (listErr) {
      console.error('Failed to list forms in storage:', listErr);
    } else {
      const isDeleted = !oldFileExists || oldFileExists.length === 0 || !oldFileExists.some(f => f.name === path.basename(initialPdfPath));
      console.log(isDeleted ? '✓ Verified: Old PDF has been successfully removed from storage!' : '❌ Warning: Old PDF is still present in storage.');
    }

  } catch (err) {
    console.error('❌ Integration test failed:', err.response ? err.response.data : err.message);
  } finally {
    // 6. Cleanup database and storage
    console.log('\nCleaning up database & storage files...');
    
    // Fetch current form details to know what to delete in storage
    const { data: finalForm } = await supabaseAdmin
      .from('blank_forms')
      .select('*')
      .eq('id', tempFormId)
      .single();

    if (finalForm && finalForm.pdf_url) {
      const storagePathPrefix = 'gp-delivery/';
      const idx = finalForm.pdf_url.indexOf(storagePathPrefix);
      if (idx !== -1) {
        const finalFilename = finalForm.pdf_url.slice(idx + storagePathPrefix.length);
        await supabaseAdmin.storage.from('gp-delivery').remove([finalFilename]);
        console.log(`✓ Deleted current test form PDF from storage: ${finalFilename}`);
      }
    }

    // Delete first PDF if it wasn't deleted
    await supabaseAdmin.storage.from('gp-delivery').remove([initialPdfPath]);

    const { error: deleteErr } = await supabaseAdmin
      .from('blank_forms')
      .delete()
      .eq('id', tempFormId);

    if (deleteErr) {
      console.error('Failed to delete temporary record:', deleteErr);
    } else {
      console.log('✓ Deleted temporary DB record.');
    }
    
    console.log('\n=== VERIFICATION COMPLETE ===');
  }
}

run();
