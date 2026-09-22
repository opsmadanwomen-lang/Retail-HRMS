import { createClient } from '@supabase/supabase-js';
const url = 'https://llchhjmyuddjselhxbry.supabase.co';
const anon = 'sb_publishable_cxP_MWMm1Ad8SNboZK_h6w_49Qwiz8M';
const supabase = createClient(url, anon);
(async () => {
  try {
    const { data, error, status } = await supabase.from('attendance_records').select('id').limit(1);
    console.log('status:', status);
    if (error) console.error('error:', error);
    else console.log('data:', data);
  } catch (e) {
    console.error('exception', e);
  }
})();
