import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cxptcntplvuyqdolqoxo.supabase.co';
const supabaseKey = 'sb_publishable_rtdYct-iYIHyikvxnZRMCw_y2X9iLOw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testUpdate() {
  console.log('Attempting update with credentials...');
  const { data, error } = await supabase
    .from('teams')
    .update({ current_sector: 1 })
    .eq('team_name', 'm')
    .eq('password', '1')
    .select();

  console.log('Update result:', { data, error });
}

testUpdate();
