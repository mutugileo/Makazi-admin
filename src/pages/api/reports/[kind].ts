import type { APIRoute } from 'astro';
import { errorMessage } from '../../../lib/errors';
import { getPortfolio } from '../../../data/portfolio';
import { buildReports, reportRangeFrom } from '../../../data/reports';

/**
 * Report downloads as CSV (opens in Excel / Google Sheets), for the signed-in
 * company only. Same numbers as the Reports page for the same range.
 * GET /api/reports/<kind>.csv?range=6|12|all
 *
 * No tenant phone numbers or emails: reports get forwarded.
 */

type Cell = string | number | null | undefined;

// Excel and Sheets run cells starting with = + - @ as formulas; a tenant
// name like "=HYPERLINK(...)" must stay text.
function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csv = (header: string[], rows: Cell[][]) =>
  '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export const GET: APIRoute = async ({ params, url, locals, cookies }) => {
  const user = locals.user;
  if (!user) return new Response('Unauthorized', { status: 401 });

  const kind = (params.kind ?? '').replace(/\.csv$/, '');
  try {
    const portfolio = await getPortfolio(user.companyId, cookies);
    const reports = buildReports(portfolio, reportRangeFrom(url));
    const stamp = portfolio.asOf;
    let body: string;

    switch (kind) {
      case 'rent-roll':
        body = csv(
          ['Property', 'Unit', 'Bedrooms', 'Status', 'Tenant', 'Account', 'Rent', 'Deposit held', 'Moved in', 'Balance'],
          portfolio.propertyViews.flatMap((pv) =>
            pv.units.map(({ unit, occupant }) => [
              pv.property.name,
              unit.label,
              unit.bedrooms,
              occupant ? 'Occupied' : 'Vacant',
              occupant?.tenant.name,
              occupant?.accountNumber,
              occupant?.tenancy.rent,
              occupant?.depositHeld,
              occupant?.tenancy.moveIn,
              occupant?.balance,
            ]),
          ),
        );
        break;
      case 'collections':
        body = csv(
          ['Month', 'Billed (rent, water, garbage)', 'Collected', 'Collection rate %', 'M-Pesa', 'Bank'],
          reports.monthly.map((m) => [m.label, m.billed, m.collected, m.rate, m.mpesa, m.bank]),
        );
        break;
      case 'by-property':
        body = csv(
          ['Property', 'Units', 'Occupied', 'Billed', 'Collected', 'Collection rate %'],
          reports.byProperty.map((p) => [p.name, p.units, p.occupied, p.billed, p.collected, p.rate]),
        );
        break;
      case 'arrears':
        body = csv(
          ['Tenant', 'Unit', 'Account', 'Balance', 'Status', 'Days overdue'],
          portfolio.arrears.map((t) => [
            t.tenant.name,
            t.unitLabel,
            t.accountNumber,
            t.balance,
            t.stage === 'overdue' ? 'Overdue' : t.stage === 'grace' ? 'In grace period' : 'Not yet due',
            t.daysOverdue,
          ]),
        );
        break;
      case 'occupancy':
        body = csv(
          ['Month', 'Occupied units', 'Total units', 'Occupancy %', 'Move-ins', 'Move-outs'],
          reports.monthly.map((m) => [m.label, m.occupied, reports.occupancy.total, m.occupancyRate, m.moveIns, m.moveOuts]),
        );
        break;
      case 'maintenance':
        body = csv(
          ['Request', 'Category', 'Priority', 'Status', 'Unit', 'Reported', 'Resolved', 'Days to fix', 'Fixed by'],
          portfolio.tickets
            .filter((t) => reports.months.includes(t.ticket.createdAt.slice(0, 7)))
            .map((t) => [
              t.ticket.id,
              t.categoryLabel,
              t.priorityLabel,
              t.statusLabel,
              t.view.unitLabel,
              t.ticket.createdAt.slice(0, 10),
              t.ticket.resolvedAt?.slice(0, 10),
              t.ticket.resolvedAt
                ? Math.round(((Date.parse(t.ticket.resolvedAt) - Date.parse(t.ticket.createdAt)) / 86_400_000) * 10) / 10
                : null,
              t.ticket.assignedTo,
            ]),
        );
        break;
      default:
        return new Response('Unknown report', { status: 404 });
    }

    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="makazi-${kind}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    return new Response(`Could not build the report: ${errorMessage(err)}`, { status: 500 });
  }
};
