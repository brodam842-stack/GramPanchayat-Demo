const { supabaseAdmin } = require('../src/config/supabase');

async function main() {
  const { data, error } = await supabaseAdmin
    .from('tax_records')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching tax_records:', error);
  } else {
    console.log('tax_records row keys:', Object.keys(data[0] || {}));
    console.log('Full first row:', data[0]);
  }
}

main().catch(console.error);
