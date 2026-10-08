import type { APIRoute } from 'astro';
import { getSupabaseConfig } from '../../lib/supabase';

export const GET: APIRoute = async () => {
  const startTime = Date.now();
  let dbStatus = 'healthy';
  let dbLatencyMs = 0;

  try {
    const config = getSupabaseConfig();
    if (!config) {
      dbStatus = 'unconfigured';
    } else {
      const t0 = Date.now();
      const res = await fetch(`${config.url}/rest/v1/`, {
        headers: { apikey: config.anonKey },
      });
      dbLatencyMs = Date.now() - t0;
      if (!res.ok && res.status !== 404) {
        dbStatus = `degraded: http ${res.status}`;
      }
    }
  } catch (err: unknown) {
    dbStatus = err instanceof Error ? `unreachable: ${err.message}` : 'unreachable';
  }

  const isHealthy = dbStatus === 'healthy' || dbStatus.startsWith('degraded');

  return new Response(
    JSON.stringify({
      status: isHealthy ? 'pass' : 'fail',
      service: 'makazi-propadmin',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime ? process.uptime() : null,
      checks: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
      },
      responseTimeMs: Date.now() - startTime,
    }),
    {
      status: isHealthy ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
};
