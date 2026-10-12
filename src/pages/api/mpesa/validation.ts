import type { APIRoute } from 'astro';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Safaricom Daraja C2B Validation Webhook Endpoint
 * Sub-50ms response to Safaricom validation call.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body?.BusinessShortCode || !body?.BillRefNumber) {
      return json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    return json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch {
    return json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
};
