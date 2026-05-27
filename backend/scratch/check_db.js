const { supabaseAdmin } = require('../src/config/supabase');

async function test() {
  console.log('Querying transaction_logs table...');
  const { data, error, count } = await supabaseAdmin
    .from('transaction_logs')
    .select('*', { count: 'exact' });

  if (error) {
    console.error('Supabase Query Error:', error.message);
  } else {
    console.log(`Successfully fetched ${data.length} records. Total count: ${count}`);
    if (data.length > 0) {
      console.log('First record:', data[0]);
    }
  }
}

test();
