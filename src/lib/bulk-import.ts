// Bulk Property & Rent Roll Ingestion Engine for Makazi PropAdmin.
// Designed for property management companies onboarding 50-500+ units in seconds.

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseKenyanPhone, phoneSpellings, issueOneTimePassword, generateOneTimePassword } from './tenant-auth';

export interface BulkImportRow {
  rowNumber: number;
  propertyName: string;
  propertyType: 'apartments' | 'houses';
  accountPrefix: string;
  waterRate: number;
  garbageFee: number;
  address: string;
  unitLabel: string;
  bedrooms: number;
  rent: number;
  deposit: number;
  isListed: boolean;
  tenantName?: string;
  tenantPhone?: string;
  tenantEmail?: string;
  moveInDate?: string;
  openingBalance?: number;
  openingReading?: number | null;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ImportWarning {
  row: number;
  message: string;
}

export interface ImportValidationResult {
  valid: boolean;
  rows: BulkImportRow[];
  errors: ImportError[];
  warnings: ImportWarning[];
  summary: {
    propertiesCount: number;
    propertiesList: string[];
    unitsCount: number;
    tenanciesCount: number;
    totalMonthlyRent: number;
  };
}

export interface ImportExecutionResult {
  success: boolean;
  propertiesCreated: number;
  propertiesReused: number;
  unitsCreated: number;
  tenanciesCreated: number;
  errors: string[];
}

/** Parses CSV text handling RFC-4180 quotes, escaped quotes, newlines, and BOM. */
export function parseCsvRows(csvText: string): string[][] {
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  if (!clean) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentField.trim());
      if (currentRow.some((f) => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/** Normalizes header names for flexible Excel/CSV import */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Validates and parses raw CSV text into structured import rows. */
export function validateBulkCsv(csvText: string): ImportValidationResult {
  const table = parseCsvRows(csvText);
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const validRows: BulkImportRow[] = [];

  if (table.length < 2) {
    return {
      valid: false,
      rows: [],
      errors: [{ row: 1, field: 'csv', message: 'CSV file must contain a header row and at least one data row.' }],
      warnings: [],
      summary: { propertiesCount: 0, propertiesList: [], unitsCount: 0, tenanciesCount: 0, totalMonthlyRent: 0 },
    };
  }

  const rawHeaders = table[0];
  const headerMap = new Map<string, number>();
  rawHeaders.forEach((h, idx) => {
    headerMap.set(normalizeHeader(h), idx);
  });

  const getCol = (row: string[], ...aliases: string[]): string => {
    for (const alias of aliases) {
      const idx = headerMap.get(normalizeHeader(alias));
      if (idx !== undefined && row[idx] !== undefined) {
        return row[idx].trim();
      }
    }
    return '';
  };

  const propertyUnits = new Map<string, Set<string>>();
  const propertiesSet = new Set<string>();
  let totalMonthlyRent = 0;
  let tenanciesCount = 0;

  for (let i = 1; i < table.length; i++) {
    const rawRow = table[i];
    if (rawRow.every((val) => !val)) continue; // skip blank rows
    const rowNum = i + 1;

    const propName = getCol(rawRow, 'Property Name', 'Property', 'Building', 'Estate');
    const propTypeRaw = getCol(rawRow, 'Type', 'Property Type').toLowerCase();
    const prefixRaw = getCol(rawRow, 'Account Prefix', 'Prefix', 'Code');
    const waterRaw = getCol(rawRow, 'Water Rate', 'Water Rate (KES/m3)', 'Water');
    const garbageRaw = getCol(rawRow, 'Garbage Fee', 'Garbage Fee (KES/mo)', 'Garbage');
    const address = getCol(rawRow, 'Address', 'Location');

    const unitLabel = getCol(rawRow, 'Unit Label', 'Unit', 'Door', 'House No');
    const bedroomsRaw = getCol(rawRow, 'Bedrooms', 'Beds', 'Rooms');
    const rentRaw = getCol(rawRow, 'Rent', 'Monthly Rent', 'Rent (KES)');
    const depositRaw = getCol(rawRow, 'Deposit', 'Deposit (KES)');
    const isListedRaw = getCol(rawRow, 'Is Listed', 'Listed', 'Listing Status').toLowerCase();

    const tenantName = getCol(rawRow, 'Tenant Name', 'Tenant', 'Occupant');
    const tenantPhone = getCol(rawRow, 'Tenant Phone', 'Phone', 'Mobile');
    const tenantEmail = getCol(rawRow, 'Tenant Email', 'Email');
    const moveInRaw = getCol(rawRow, 'Move In Date', 'Move In');
    const openingBalRaw = getCol(rawRow, 'Opening Balance', 'Balance', 'Arrears');
    const openingReadingRaw = getCol(rawRow, 'Opening Water Reading', 'Water Reading', 'Opening Reading');

    // Validations:
    if (!propName) {
      errors.push({ row: rowNum, field: 'propertyName', message: 'Property name is required.' });
    } else if (propName.length > 120) {
      errors.push({ row: rowNum, field: 'propertyName', message: 'Property name cannot exceed 120 characters.' });
    }

    if (!unitLabel) {
      errors.push({ row: rowNum, field: 'unitLabel', message: 'Unit label is required.' });
    } else if (unitLabel.length > 40) {
      errors.push({ row: rowNum, field: 'unitLabel', message: 'Unit label cannot exceed 40 characters.' });
    }

    const rent = Math.round(Number(rentRaw.replace(/[^0-9.-]/g, '')));
    if (!rentRaw || isNaN(rent) || rent <= 0) {
      errors.push({ row: rowNum, field: 'rent', message: 'Rent must be a positive number.' });
    }

    let deposit = rent; // default to 1 month rent if blank
    if (depositRaw) {
      const depParsed = Math.round(Number(depositRaw.replace(/[^0-9.-]/g, '')));
      if (!isNaN(depParsed) && depParsed >= 0) {
        deposit = depParsed;
      } else {
        errors.push({ row: rowNum, field: 'deposit', message: 'Deposit must be 0 or greater.' });
      }
    }

    const bedrooms = bedroomsRaw ? Math.max(0, Math.min(10, parseInt(bedroomsRaw, 10) || 0)) : 1;
    const waterRate = waterRaw ? Math.max(0, Math.round(Number(waterRaw.replace(/[^0-9.-]/g, '')) || 0)) : 0;
    const garbageFee = garbageRaw ? Math.max(0, Math.round(Number(garbageRaw.replace(/[^0-9.-]/g, '')) || 0)) : 0;
    const propertyType: 'apartments' | 'houses' = propTypeRaw.includes('house') ? 'houses' : 'apartments';

    // Account prefix generation if missing
    let accountPrefix = prefixRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!accountPrefix && propName) {
      accountPrefix = propName
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 4);
    }

    // Duplicate unit label check in CSV
    if (propName && unitLabel) {
      const propKey = propName.toLowerCase();
      if (!propertyUnits.has(propKey)) {
        propertyUnits.set(propKey, new Set());
      }
      const unitKey = unitLabel.toLowerCase();
      const existingUnits = propertyUnits.get(propKey)!;
      if (existingUnits.has(unitKey)) {
        errors.push({ row: rowNum, field: 'unitLabel', message: `Duplicate unit '${unitLabel}' in property '${propName}'.` });
      } else {
        existingUnits.add(unitKey);
      }
    }

    // Tenant validations if provided
    let normalizedPhone: string | undefined;
    let validatedMoveIn: string | undefined;
    let openingBalance: number | undefined;
    let openingReading: number | null | undefined;

    const hasTenantInfo = Boolean(tenantName || tenantPhone);
    if (hasTenantInfo) {
      if (!tenantName) {
        errors.push({ row: rowNum, field: 'tenantName', message: 'Tenant name is required when phone is provided.' });
      }
      if (!tenantPhone) {
        errors.push({ row: rowNum, field: 'tenantPhone', message: 'Tenant phone number is required.' });
      } else {
        const parsed = parseKenyanPhone(tenantPhone);
        if (!parsed) {
          errors.push({ row: rowNum, field: 'tenantPhone', message: `Invalid Kenyan phone '${tenantPhone}'. Must be valid Safaricom/Airtel number.` });
        } else {
          normalizedPhone = parsed.local;
        }
      }

      if (moveInRaw) {
        const isoMatch = /^\d{4}-\d{2}-\d{2}$/.test(moveInRaw.trim());
        if (!isoMatch) {
          errors.push({ row: rowNum, field: 'moveInDate', message: 'Move-in date must be in YYYY-MM-DD format.' });
        } else {
          validatedMoveIn = moveInRaw.trim();
        }
      } else {
        validatedMoveIn = new Date().toISOString().slice(0, 10);
      }

      if (openingBalRaw) {
        const balParsed = Math.round(Number(openingBalRaw.replace(/[^0-9.-]/g, '')));
        if (!isNaN(balParsed)) {
          openingBalance = balParsed;
        }
      }

      if (openingReadingRaw) {
        const readingParsed = Math.round(Number(openingReadingRaw.replace(/[^0-9.-]/g, '')));
        if (!isNaN(readingParsed) && readingParsed >= 0) {
          openingReading = readingParsed;
        }
      }

      tenanciesCount++;
    }

    const isListed = isListedRaw === 'yes' || isListedRaw === 'true' || isListedRaw === '1' || (!hasTenantInfo && isListedRaw !== 'no' && isListedRaw !== 'false');

    if (propName) propertiesSet.add(propName.trim());
    if (rent > 0) totalMonthlyRent += rent;

    validRows.push({
      rowNumber: rowNum,
      propertyName: propName.trim(),
      propertyType,
      accountPrefix,
      waterRate,
      garbageFee,
      address: address.trim(),
      unitLabel: unitLabel.trim(),
      bedrooms,
      rent,
      deposit,
      isListed,
      tenantName: tenantName?.trim() || undefined,
      tenantPhone: normalizedPhone,
      tenantEmail: tenantEmail?.trim() || undefined,
      moveInDate: validatedMoveIn,
      openingBalance: openingBalance ?? 0,
      openingReading: openingReading ?? null,
    });
  }

  const propList = Array.from(propertiesSet);

  return {
    valid: errors.length === 0,
    rows: validRows,
    errors,
    warnings,
    summary: {
      propertiesCount: propList.length,
      propertiesList: propList,
      unitsCount: validRows.length,
      tenanciesCount,
      totalMonthlyRent,
    },
  };
}

/** Executes the bulk import transaction into Supabase, scoped to companyId. */
export async function executeBulkImport(
  supabase: SupabaseClient,
  companyId: string,
  rows: BulkImportRow[],
  defaultManagerId?: string,
): Promise<ImportExecutionResult> {
  const result: ImportExecutionResult = {
    success: false,
    propertiesCreated: 0,
    propertiesReused: 0,
    unitsCreated: 0,
    tenanciesCreated: 0,
    errors: [],
  };

  if (rows.length === 0) {
    result.errors.push('No valid rows provided for import.');
    return result;
  }

  // 1. Resolve manager for properties
  let managerId = defaultManagerId;
  if (!managerId) {
    const { data: staffList, error: staffErr } = await supabase
      .from('staff')
      .select('id, role')
      .eq('company_id', companyId)
      .in('role', ['owner', 'manager']);

    if (staffErr || !staffList || staffList.length === 0) {
      result.errors.push('No manager or owner found for this company to assign properties.');
      return result;
    }
    managerId = staffList[0].id;
  }

  // 2. Fetch existing properties for this company
  const { data: existingProps, error: propsErr } = await supabase
    .from('properties')
    .select('id, name, account_prefix')
    .eq('company_id', companyId);

  if (propsErr) {
    result.errors.push(`Failed to fetch company properties: ${propsErr.message}`);
    return result;
  }

  const propertyMapByName = new Map<string, string>();
  const usedPrefixes = new Set<string>();

  for (const p of existingProps || []) {
    propertyMapByName.set(p.name.trim().toLowerCase(), p.id);
    usedPrefixes.add(p.account_prefix.trim().toUpperCase());
  }

  // Group import rows by property
  const rowsByProperty = new Map<string, BulkImportRow[]>();
  for (const row of rows) {
    const key = row.propertyName.trim().toLowerCase();
    if (!rowsByProperty.has(key)) {
      rowsByProperty.set(key, []);
    }
    rowsByProperty.get(key)!.push(row);
  }

  // 3. Process each property
  for (const [propKey, propRows] of rowsByProperty.entries()) {
    const firstRow = propRows[0];
    let propertyId = propertyMapByName.get(propKey);

    if (!propertyId) {
      // Create new property
      let desiredPrefix = firstRow.accountPrefix.toUpperCase();
      if (usedPrefixes.has(desiredPrefix)) {
        // Disambiguate prefix
        let suffix = 1;
        while (usedPrefixes.has(`${desiredPrefix.slice(0, 3)}${suffix}`)) {
          suffix++;
        }
        desiredPrefix = `${desiredPrefix.slice(0, 3)}${suffix}`;
      }

      const { data: newProp, error: createPropErr } = await supabase
        .from('properties')
        .insert({
          company_id: companyId,
          manager_id: managerId,
          name: firstRow.propertyName,
          type: firstRow.propertyType,
          address: firstRow.address,
          account_prefix: desiredPrefix,
          water_rate: firstRow.waterRate,
          garbage_fee: firstRow.garbageFee,
          rate_history: [],
        })
        .select('id')
        .single();

      if (createPropErr || !newProp) {
        result.errors.push(`Failed to create property '${firstRow.propertyName}': ${createPropErr?.message}`);
        continue;
      }

      propertyId = newProp.id;
      propertyMapByName.set(propKey, propertyId);
      usedPrefixes.add(desiredPrefix);
      result.propertiesCreated++;
    } else {
      result.propertiesReused++;
    }

    // 4. Fetch existing units for this property to avoid unique constraint violations
    const { data: existingUnits, error: unitsErr } = await supabase
      .from('units')
      .select('id, label')
      .eq('company_id', companyId)
      .eq('property_id', propertyId);

    if (unitsErr) {
      result.errors.push(`Failed to check existing units for property '${firstRow.propertyName}': ${unitsErr.message}`);
      continue;
    }

    const existingUnitMap = new Map<string, string>();
    for (const u of existingUnits || []) {
      existingUnitMap.set(u.label.trim().toLowerCase(), u.id);
    }

    // 5. Insert units & onboard tenancies
    for (const row of propRows) {
      const unitKey = row.unitLabel.trim().toLowerCase();
      let unitId = existingUnitMap.get(unitKey);

      if (!unitId) {
        const { data: newUnit, error: createUnitErr } = await supabase
          .from('units')
          .insert({
            company_id: companyId,
            property_id: propertyId,
            label: row.unitLabel,
            bedrooms: row.bedrooms,
            is_listed: row.isListed,
            listed_rent: row.isListed ? row.rent : null,
            listing_notes: '',
          })
          .select('id')
          .single();

        if (createUnitErr || !newUnit) {
          result.errors.push(`Failed to create unit '${row.unitLabel}' in '${row.propertyName}': ${createUnitErr?.message}`);
          continue;
        }

        unitId = newUnit.id;
        existingUnitMap.set(unitKey, unitId);
        result.unitsCreated++;
      }

      // 6. Onboard tenant if present
      if (row.tenantName && row.tenantPhone && unitId) {
        try {
          const parsedPhone = parseKenyanPhone(row.tenantPhone);
          if (!parsedPhone) continue;

          // Check if tenant already exists in company
          const { data: existingTenant } = await supabase
            .from('tenants')
            .select('id, auth_user_id')
            .eq('company_id', companyId)
            .in('phone', phoneSpellings(parsedPhone))
            .maybeSingle();

          let tenantId: string;
          if (existingTenant) {
            tenantId = existingTenant.id;
          } else {
            const { data: newTenant, error: newTenantErr } = await supabase
              .from('tenants')
              .insert({
                company_id: companyId,
                name: row.tenantName,
                phone: parsedPhone.local,
                email: row.tenantEmail || '',
              })
              .select('id')
              .single();

            if (newTenantErr || !newTenant) {
              result.errors.push(`Failed to create tenant '${row.tenantName}': ${newTenantErr?.message}`);
              continue;
            }
            tenantId = newTenant.id;

            // Generate temporary PIN credentials for tenant mobile app
            const tempPin = generateOneTimePassword();
            try {
              const authUserId = await issueOneTimePassword(supabase, {
                phone: parsedPhone,
                password: tempPin,
                name: row.tenantName,
                companyId,
                knownUserId: existingTenant?.auth_user_id,
              });
              await supabase.from('tenants').update({ auth_user_id: authUserId }).eq('id', tenantId);
            } catch (authErr: unknown) {
              // Non-blocking credential creation: report in result errors so the admin is informed
              const authMsg = authErr instanceof Error ? authErr.message : String(authErr);
              result.errors.push(`Tenant '${row.tenantName}' onboarded, but app login creation failed: ${authMsg}`);
            }
          }

          // Check if unit already has an active tenancy
          const { data: currentTenancy } = await supabase
            .from('tenancies')
            .select('id')
            .eq('company_id', companyId)
            .eq('unit_id', unitId)
            .is('move_out', null)
            .maybeSingle();

          if (!currentTenancy) {
            const moveIn = row.moveInDate || new Date().toISOString().slice(0, 10);
            const leaseEnd = new Date(`${moveIn}T00:00:00Z`);
            leaseEnd.setUTCFullYear(leaseEnd.getUTCFullYear() + 1);
            leaseEnd.setUTCDate(leaseEnd.getUTCDate() - 1);

            const { error: tenancyErr } = await supabase.from('tenancies').insert({
              company_id: companyId,
              tenant_id: tenantId,
              unit_id: unitId,
              rent: row.rent,
              deposit: row.deposit,
              move_in: moveIn,
              lease_start: moveIn,
              lease_end: leaseEnd.toISOString().slice(0, 10),
              opening_balance: row.openingBalance ?? 0,
              opening_reading: row.openingReading ?? null,
              move_in_garbage: row.garbageFee,
            });

            if (!tenancyErr) {
              result.tenanciesCreated++;
            } else {
              result.errors.push(`Failed to create tenancy for unit '${row.unitLabel}': ${tenancyErr.message}`);
            }
          }
        } catch (err: unknown) {
          result.errors.push(`Error onboarding tenant for row ${row.rowNumber}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  result.success = result.errors.length === 0 || result.unitsCreated > 0;
  return result;
}

