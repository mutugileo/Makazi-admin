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
// left open on the server per request. Failures are logged, never thrown,
// and a slow Realtime never holds a request for more than about 3s: the
// write that triggered the nudge has already succeeded.

import type { SupabaseClient } from '@supabase/supabase-js';

type Payload = Record<string, string | number | boolean | null>;

/** Longest a nudge may hold up the request that sent it. */
const SEND_TIMEOUT_MS = 2_000;
/** Cleanup gets a little longer; it is not awaited past this. */
const REMOVE_TIMEOUT_MS = 500;

async function within<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function send(supabase: SupabaseClient, topic: string, event: string, payload: Payload): Promise<void> {
  let channel: ReturnType<SupabaseClient['channel']> | null = null;
  try {
    channel = supabase.channel(topic);
    // httpSend aborts its own fetch at the timeout; the race is a backstop.
    const res = await within(channel.httpSend(event, payload, { timeout: SEND_TIMEOUT_MS }), SEND_TIMEOUT_MS + 250, 'send');
    if (!res.success) console.warn(`[realtime] ${topic} ${event}: ${res.status} ${res.error}`);
  } catch (err) {
    console.warn(`[realtime] ${topic} ${event}:`, err);
  } finally {
    if (channel) {
      try {
        await within(supabase.removeChannel(channel), REMOVE_TIMEOUT_MS, 'removeChannel');
      } catch (err) {
        console.warn(`[realtime] ${topic} cleanup:`, err);
      }
    }
  }
}

/** Never rejects; settles within about 3s. */
export function notifyCompany(supabase: SupabaseClient, companyId: string, event: string, payload: Payload = {}): Promise<void> {
  return send(supabase, `makazi:events:${companyId}`, event, payload);
}

/** Never rejects; settles within about 3s. */
export function notifyTenancy(supabase: SupabaseClient, tenancyId: string, event: string, payload: Payload = {}): Promise<void> {
  return send(supabase, `makazi:tenancy:${tenancyId}`, event, payload);
}
