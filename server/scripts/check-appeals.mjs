import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf8');
const envVars = {};
for (const line of env.split('\n')) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = (match[2] || '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envVars[match[1]] = val;
  }
}

const client = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SECRET_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY);

let { data, error } = await client
  .from('account_appeals')
  .select('id, user_id, email, message, status, admin_note, created_at, reviewed_at, reviewed_by, profiles!account_appeals_user_id_fkey(first_name, last_name, role)')
  .order('created_at', { ascending: false });

console.log('ACCOUNT_APPEALS WITH EXPLICIT FK ERROR:', error);
console.log('ACCOUNT_APPEALS WITH EXPLICIT FK DATA:', JSON.stringify(data, null, 2));

const { data: usersData } = await client.auth.admin.listUsers();
console.log('USERS IN AUTH:', usersData?.users?.map(u => ({ id: u.id, email: u.email })));

const { data: blocked } = await client.from('profiles').select('id, first_name, last_name, role, is_blocked, block_reason').eq('is_blocked', true);
console.log('BLOCKED PROFILES:', blocked);
