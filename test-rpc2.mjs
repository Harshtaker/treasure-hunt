import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cxptcntplvuyqdolqoxo.supabase.co';
const supabaseKey = 'sb_publishable_rtdYct-iYIHyikvxnZRMCw_y2X9iLOw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testRPC() {
  const teamId = 'a16f07eb-2f1c-49dc-a85d-ada3a0770e1c';
  
  console.log('Testing RPC scan_success_trigger with null start_time...');
  const { data: data2, error: err2 } = await supabase.rpc('scan_success_trigger', {
    t_id: teamId,
    target_round: 1,
    start_time: null
  });
  console.log('scan_success_trigger null:', { data2, err2 });
}

testRPC();
