// Live nudges to the tenant app over Supabase Realtime broadcast.
//
// Broadcast topics are not covered by table RLS, so anyone holding the public
// key could listen. Payloads therefore never carry message text, names or
// amounts: they only tell the app "something changed, refetch", and the app
// re-reads through RLS.
//
//   makazi:events:<companyId>    data_updated (property, rates, readings)
//   makazi:tenancy:<tenancyId>   data_updated, message_sent, typing
//
// Sent over HTTP and the channel is removed straight after, so no socket is
// left open on the server per request. Failures are logged, never thrown:
// the write that triggered the nudge has already succeeded.

import type { SupabaseClient } from '@supabase/supabase-js';

type Payload = Record<string, string | number | boolean | null>;

async function send(supabase: SupabaseClient, topic: string, event: string, payload: Payload) {
  const channel = supabase.channel(topic);
  try {
    const res = await channel.httpSend(event, payload, { timeout: 5000 });
    if (!res.success) console.warn(`[realtime] ${topic} ${event}: ${res.status} ${res.error}`);
  } catch (err) {
    console.warn(`[realtime] ${topic} ${event}:`, err);
  } finally {
    await supabase.removeChannel(channel);
  }
}

export function notifyCompany(supabase: SupabaseClient, companyId: string, event: string, payload: Payload = {}) {
  return send(supabase, `makazi:events:${companyId}`, event, payload);
}

export function notifyTenancy(supabase: SupabaseClient, tenancyId: string, event: string, payload: Payload = {}) {
  return send(supabase, `makazi:tenancy:${tenancyId}`, event, payload);
}
