import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cxptcntplvuyqdolqoxo.supabase.co';
const supabaseKey = 'sb_publishable_rtdYct-iYIHyikvxnZRMCw_y2X9iLOw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('Fetching one team...');
  const { data: team, error: fetchErr } = await supabase.from('teams').select('*').limit(1).single();
  if (fetchErr) {
    console.error('Fetch error:', fetchErr);
    return;
  }
  console.log('Team data:', team);

  console.log('Attempting to update...');
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('teams')
    .update({ 
      current_sector: team.current_sector || 0,
      last_clue_start: now,
      status: 'ACTIVE'
    })
    .eq('id', team.id)
    .select(); // Ask Supabase to return the updated row

  if (error) {
    console.error('UPDATE ERROR:', error);
  } else {
    console.log('UPDATE SUCCESS:', data);
  }
}

test();
