// Payment messages tenants paste in the app (public.payment_claims). Staff
// confirm one against the Paybill or bank statement, which records the
// payment, or reject it with a reason the tenant sees.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IsoDate } from './billing';

export interface PaymentClaim {
  id: string;
  tenancyId: string;
  /** What the tenant pasted. */
  message: string;
  /** Read from the message; null when it couldn't be read. */
  reference: string | null;
  amount: number | null;
  paidDate: IsoDate | null;
  paidTime: string | null;
  payer: string | null;
  createdAt: string;
}

interface PaymentClaimRow {
  id: string;
  tenancy_id: string;
  message: string;
  reference: string | null;
  amount: number | null;
  paid_date: string | null;
  paid_time: string | null;
  payer: string | null;
  created_at: string;
}

/** This company's messages waiting for review, oldest first. Throws if unreadable. */
export async function fetchPendingClaims(supabase: SupabaseClient, companyId: string): Promise<PaymentClaim[]> {
  const { data, error } = await supabase
    .from('payment_claims')
    .select('id, tenancy_id, message, reference, amount, paid_date, paid_time, payer, created_at')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as PaymentClaimRow[]).map((r) => ({
    id: r.id,
    tenancyId: r.tenancy_id,
    message: r.message,
    reference: r.reference,
    amount: r.amount,
    paidDate: r.paid_date,
    paidTime: r.paid_time,
    payer: r.payer,
    createdAt: r.created_at,
  }));
}

/** How many messages wait for review. Throws if unreadable. */
export async function countPendingClaims(supabase: SupabaseClient, companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('payment_claims')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}
