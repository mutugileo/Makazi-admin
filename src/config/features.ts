// Product switches. Off means hidden everywhere in the admin; the data model
// and code stay so a feature can come back without rework.
// Keep in step with lib/core/config/features.dart in the tenant app.
export const FEATURES = {
  /** Lease terms, renewals and countersigning. Hidden for now. */
  leases: false,
} as const;
