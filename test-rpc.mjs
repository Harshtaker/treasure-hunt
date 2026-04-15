import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cxptcntplvuyqdolqoxo.supabase.co';
const supabaseKey = 'sb_publishable_rtdYct-iYIHyikvxnZRMCw_y2X9iLOw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testRPC() {
  const teamId = 'a16f07eb-2f1c-49dc-a85d-ada3a0770e1c'; // From previous test
  const now = new Date().toISOString();
  
  console.log('Testing RPC update_team_progress...');
  const { data: data1, error: err1 } = await supabase.rpc('update_team_progress', {
    t_id: teamId,
    target_round: 1,
    start_time: now
  });
  console.log('update_team_progress:', { data1, err1 });

  console.log('Testing RPC scan_success_trigger...');
  const { data: data2, error: err2 } = await supabase.rpc('scan_success_trigger', {
    t_id: teamId,
    target_round: 1,
    start_time: now
  });
  console.log('scan_success_trigger:', { data2, err2 });

  console.log('Fetching functions definition (if possible)...');
  const { data, error } = await supabase.from('teams').select('*').limit(1);
}

testRPC();
