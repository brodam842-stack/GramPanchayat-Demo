const { supabaseAdmin } = require('../src/config/supabase');

async function main() {
  console.log('Updating gp-delivery bucket to allow PDFs and images...');
  
  const { data, error } = await supabaseAdmin.storage.updateBucket('gp-delivery', {
    public: true,
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'],
    fileSizeLimit: 15 * 1024 * 1024 // 15MB
  });

  if (error) {
    console.error('Error updating bucket:', error);
    process.exit(1);
  }

  console.log('Successfully updated gp-delivery bucket!', data);
  
  // Verify bucket configuration
  const { data: bucket, error: getError } = await supabaseAdmin.storage.getBucket('gp-delivery');
  if (getError) {
    console.error('Error getting bucket:', getError);
    process.exit(1);
  }
  console.log('Current gp-delivery bucket config:', bucket);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
