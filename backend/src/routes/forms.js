const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { authenticate } = require('./auth');
const { supabaseAdmin } = require('../config/supabase');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

// All forms management routes require admin authentication
router.use(authenticate);

/**
 * GET /api/forms
 * Lists all blank application forms
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('blank_forms')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ forms: data || [] });
  } catch (err) {
    console.error('[Forms] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch forms: ' + err.message });
  }
});

/**
 * POST /api/forms
 * Uploads a blank form PDF and inserts it into database
 */
router.post('/', upload.single('file'), async (req, res) => {
  const { name, required_documents } = req.body;
  const file = req.file;

  if (!name || !required_documents) {
    return res.status(400).json({ error: 'Form name and list of required documents are required.' });
  }
  if (!file) {
    return res.status(400).json({ error: 'Blank PDF form file is required.' });
  }

  try {
    const filename = `forms/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;

    // Upload PDF to Supabase storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('gp-delivery')
      .upload(filename, file.buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw new Error('Upload error: ' + uploadError.message);

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('gp-delivery')
      .getPublicUrl(filename);

    const pdfUrl = urlData?.publicUrl;
    if (!pdfUrl) throw new Error('Failed to generate public URL.');

    // Save to database
    const { data, error: dbError } = await supabaseAdmin
      .from('blank_forms')
      .insert({
        name: name.trim(),
        required_documents: required_documents.trim(),
        pdf_url: pdfUrl,
      })
      .select()
      .single();

    if (dbError) {
      // Cleanup uploaded file on DB insertion failure
      await supabaseAdmin.storage.from('gp-delivery').remove([filename]);
      throw dbError;
    }

    res.status(201).json({ form: data, message: 'Blank application form added successfully.' });
  } catch (err) {
    console.error('[Forms] Creation error:', err.message);
    res.status(500).json({ error: 'Failed to create form: ' + err.message });
  }
});

/**
 * DELETE /api/forms/:id
 * Deletes a form and removes its PDF from storage
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Get form info to delete file from storage first
    const { data: form, error: fetchError } = await supabaseAdmin
      .from('blank_forms')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !form) {
      return res.status(404).json({ error: 'Application form not found.' });
    }

    // Extract storage filename path from public URL
    // e.g. "https://.../storage/v1/object/public/gp-delivery/forms/12345_test.pdf" -> "forms/12345_test.pdf"
    const storagePathPrefix = 'gp-delivery/';
    const pathIndex = form.pdf_url.indexOf(storagePathPrefix);
    if (pathIndex !== -1) {
      const filename = form.pdf_url.slice(pathIndex + storagePathPrefix.length);
      await supabaseAdmin.storage.from('gp-delivery').remove([filename]);
    }

    // Delete record from DB
    const { error: dbError } = await supabaseAdmin
      .from('blank_forms')
      .delete()
      .eq('id', id);

    if (dbError) throw dbError;

    res.json({ message: 'Application form deleted successfully.' });
  } catch (err) {
    console.error('[Forms] Deletion error:', err.message);
    res.status(500).json({ error: 'Failed to delete form: ' + err.message });
  }
});

/**
 * PUT /api/forms/:id
 * Edits an already made blank form template (updates metadata, optional PDF replacement)
 */
router.put('/:id', upload.single('file'), async (req, res) => {
  const { id } = req.params;
  const { name, required_documents } = req.body;
  const file = req.file;

  try {
    // 1. Fetch existing form details
    const { data: form, error: fetchError } = await supabaseAdmin
      .from('blank_forms')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !form) {
      return res.status(404).json({ error: 'Application form not found.' });
    }

    let updatedPdfUrl = form.pdf_url;
    let newFilename = '';

    // 2. If a new PDF file is uploaded, process it
    if (file) {
      newFilename = `forms/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;

      // Upload new file
      const { error: uploadError } = await supabaseAdmin.storage
        .from('gp-delivery')
        .upload(newFilename, file.buffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) throw new Error('Upload error: ' + uploadError.message);

      // Get new public URL
      const { data: urlData } = supabaseAdmin.storage
        .from('gp-delivery')
        .getPublicUrl(newFilename);

      const pdfUrl = urlData?.publicUrl;
      if (!pdfUrl) throw new Error('Failed to generate public URL.');
      updatedPdfUrl = pdfUrl;

      // Delete the old file from storage to avoid orphan files
      const storagePathPrefix = 'gp-delivery/';
      const pathIndex = form.pdf_url.indexOf(storagePathPrefix);
      if (pathIndex !== -1) {
        const oldFilename = form.pdf_url.slice(pathIndex + storagePathPrefix.length);
        await supabaseAdmin.storage.from('gp-delivery').remove([oldFilename]);
      }
    }

    // 3. Update database record
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (required_documents !== undefined) updates.required_documents = required_documents.trim();
    updates.pdf_url = updatedPdfUrl;

    const { data, error: dbError } = await supabaseAdmin
      .from('blank_forms')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (dbError) {
      // Cleanup newly uploaded file on DB update failure
      if (file && newFilename) {
        await supabaseAdmin.storage.from('gp-delivery').remove([newFilename]);
      }
      throw dbError;
    }

    res.json({ form: data, message: 'Blank application form updated successfully.' });
  } catch (err) {
    console.error('[Forms] Update error:', err.message);
    res.status(500).json({ error: 'Failed to update form: ' + err.message });
  }
});

module.exports = router;
