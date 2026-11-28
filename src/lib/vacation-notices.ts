import type { SupabaseClient } from '@supabase/supabase-js';

export interface VacationNoticeRow {
  id: string;
  companyId: string;
  tenancyId: string;
  vacatingDate: string;
  inspectionDate: string;
  inspectionSlot: string;
  reason: string;
  reasonDetails: string | null;
  depositRefundPhone: string;
  status: 'pending_landlord' | 'pending_tenant' | 'countersigned' | 'withdrawn' | 'declined';
  tenantSignatureType: 'draw' | 'type' | null;
  tenantSignatureData: string | null;
  tenantSignedAt: string | null;
  landlordSignatureType: 'draw' | 'type' | null;
  landlordSignatureData: string | null;
  landlordSignedBy: string | null;
  landlordSignedAt: string | null;
  declineNote: string | null;
  createdAt: string;
}

export async function fetchCompanyVacationNotices(
  supabase: SupabaseClient,
  companyId: string,
): Promise<VacationNoticeRow[]> {
  const { data, error } = await supabase
    .from('vacation_notices')
    .select('*')
    .eq('company_id', companyId)
    .in('status', ['pending_landlord', 'countersigned'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    // Graceful fallback if migration isn't applied yet
    if (error.code === '42P01' || error.message?.includes('vacation_notices')) {
      return [];
    }
    throw error;
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    tenancyId: r.tenancy_id,
    vacatingDate: r.vacating_date,
    inspectionDate: r.inspection_date,
    inspectionSlot: r.inspection_slot,
    reason: r.reason,
    reasonDetails: r.reason_details ?? null,
    depositRefundPhone: r.deposit_refund_phone,
    status: r.status,
    tenantSignatureType: r.tenant_signature_type ?? null,
    tenantSignatureData: r.tenant_signature_data ?? null,
    tenantSignedAt: r.tenant_signed_at ?? null,
    landlordSignatureType: r.landlord_signature_type ?? null,
    landlordSignatureData: r.landlord_signature_data ?? null,
    landlordSignedBy: r.landlord_signed_by ?? null,
    landlordSignedAt: r.landlord_signed_at ?? null,
    declineNote: r.decline_note ?? null,
    createdAt: r.created_at,
  }));
}
