import type { APIRoute } from 'astro';
import { getPortfolio, formatKes, formatDate } from '../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user || !user.companyId) {
    return json({ error: 'Unauthorized: Session missing valid company credentials' }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const requestedCompanyId = typeof body.companyProfileId === 'string' ? body.companyProfileId.trim() : null;

    if (!query) {
      return json({ error: 'Query is required' }, 400);
    }

    // ---------------------------------------------------------------------------
    // Multi-Tenancy Enforcement:
    // A user session is strictly bound to user.companyId. If an explicit
    // companyProfileId is sent, it MUST match the session's companyId.
    // ---------------------------------------------------------------------------
    const sessionCompanyId = user.companyId;
    if (requestedCompanyId && requestedCompanyId !== sessionCompanyId) {
      return json(
        { error: `Forbidden: Access to company profile '${requestedCompanyId}' is denied.` },
        403
      );
    }

    const targetCompanyId = sessionCompanyId;
    const portfolio = await getPortfolio(targetCompanyId, cookies);
    const { tenancies, repairBoard, propertyViews, stats, currentPeriod, asOf, company } = portfolio;

    // Defensive assertion: Ensure the loaded portfolio matches targetCompanyId
    if (company.id !== targetCompanyId) {
      return json({ error: 'Tenant isolation violation: loaded portfolio mismatch' }, 403);
    }

    const q = query.toLowerCase();

    // Cross-tenant boundary check: If user asks about another known company name/slug
    const knownCompanies = ['harborridge', 'codzure'];
    const otherCompanies = knownCompanies.filter((c) => c !== targetCompanyId);
    if (otherCompanies.some((c) => q.includes(c))) {
      return json({
        reply: `🔒 **Company Profile Boundary Enforced**\n\nYour session is strictly isolated to **${company.name}** (Company ID: \`${targetCompanyId}\`).\n\nUnder Makazi's multi-tenant security architecture, data from other company profiles cannot be retrieved, compared, or disclosed.`,
        type: 'boundary_enforced',
        companyProfile: {
          id: company.id,
          name: company.name,
          slug: company.slug,
        },
        data: { isolated: true, companyProfileId: targetCompanyId },
      });
    }

    // Common company profile metadata for every response
    const companyProfile = {
      id: company.id,
      name: company.name,
      slug: company.slug,
    };

    // 1. Arrears & Overdue Balances (Strictly company-scoped)
    if (q.includes('arrear') || q.includes('owe') || q.includes('overdue') || q.includes('debt') || q.includes('balance') || q.includes('unpaid')) {
      const owing = tenancies.filter((t) => t.tenant.companyId === targetCompanyId && t.isActive && t.balance > 0);
      const totalArrears = owing.reduce((sum, t) => sum + t.balance, 0);

      if (owing.length === 0) {
        return json({
          reply: `Great news! There are currently **no overdue arrears** across **${company.name}** for **${currentPeriod}**. All active tenants are up to date.`,
          type: 'arrears',
          companyProfile,
          data: { total: 0, count: 0, items: [] },
        });
      }

      const items = owing.map((t) => ({
        tenant: t.tenant.name,
        phone: t.tenant.phone,
        unit: t.unitLabel,
        balance: t.balance,
        daysOverdue: t.daysOverdue,
        tenancyId: t.tenancy.id,
        statementUrl: `/statement/${t.tenancy.id}`,
      }));

      const breakdown = items
        .map(
          (i) =>
            `• **${i.tenant}** (${i.unit}) — owes **${formatKes(i.balance)}**${i.daysOverdue > 0 ? ` (${i.daysOverdue} days overdue)` : ''}`
        )
        .join('\n');

      return json({
        reply: `In **${company.name}**, you have **${owing.length}** tenant${owing.length === 1 ? '' : 's'} with outstanding arrears totaling **${formatKes(totalArrears)}** as of ${formatDate(asOf)}:\n\n${breakdown}\n\n*Tip: You can use "Send payment reminders" from the header to notify overdue tenants.*`,
        type: 'arrears',
        companyProfile,
        data: { total: totalArrears, count: owing.length, items },
      });
    }

    // 2. Open Issues & Maintenance (Strictly company-scoped)
    if (q.includes('issue') || q.includes('maintenance') || q.includes('repair') || q.includes('ticket') || q.includes('fix') || q.includes('broken')) {
      const openTickets = repairBoard.open.filter((t) => t.ticket.companyId === targetCompanyId);
      const inProgressTickets = repairBoard.inProgress.filter((t) => t.ticket.companyId === targetCompanyId);
      const resolvedTickets = repairBoard.resolved.filter((t) => t.ticket.companyId === targetCompanyId);
      const activeTickets = [...openTickets, ...inProgressTickets];

      if (activeTickets.length === 0) {
        return json({
          reply: `All maintenance requests for **${company.name}** are clear! There are currently **0 open tickets** (${resolvedTickets.length} resolved previously).`,
          type: 'maintenance',
          companyProfile,
          data: {
            openCount: 0,
            inProgressCount: 0,
            resolvedCount: resolvedTickets.length,
            tickets: [],
          },
        });
      }

      const list = activeTickets
        .map(
          (t) =>
            `• **${t.ticket.id}**: *${t.ticket.title}* (${t.reporter} · ${t.unitLabel}) — Priority: **${t.priorityLabel}** · Status: **${t.ticket.status}**${t.ticket.assignedTo ? ` · Assigned to: ${t.ticket.assignedTo}` : ''}`
        )
        .join('\n');

      return json({
        reply: `Current active maintenance tickets for **${company.name}** (**${openTickets.length} open**, **${inProgressTickets.length} in progress**):\n\n${list}\n\n*View full ticket details on the Maintenance board.*`,
        type: 'maintenance',
        companyProfile,
        data: {
          openCount: openTickets.length,
          inProgressCount: inProgressTickets.length,
          resolvedCount: resolvedTickets.length,
          tickets: activeTickets.map((t) => t.ticket),
        },
      });
    }

    // 3. Collections & Revenue (Strictly company-scoped)
    if (q.includes('collect') || q.includes('revenue') || q.includes('income') || q.includes('payment') || q.includes('mpesa') || q.includes('bank')) {
      const billed = stats.billedThisMonth;
      const collected = stats.collectedThisMonth;
      const rate = stats.collectionRate;
      const companyPayments = portfolio.payments.filter((p) => p.view.property.companyId === targetCompanyId);
      const count = companyPayments.length;

      return json({
        reply: `Financial summary for **${company.name}** (${currentPeriod}):\n\n• **Billed**: ${formatKes(billed)}\n• **Collected**: ${formatKes(collected)}\n• **Collection Rate**: **${rate}%**\n• **Total Transactions**: ${count} payment records\n• **Deposits Held**: ${formatKes(stats.depositsHeld)} (held, not counted as revenue)`,
        type: 'collections',
        companyProfile,
        data: { billed, collected, rate, depositsHeld: stats.depositsHeld },
      });
    }

    // 4. Vacant Units & Occupancy (Strictly company-scoped)
    if (q.includes('vacant') || q.includes('empty') || q.includes('occupan') || q.includes('available')) {
      const totalUnits = stats.totalUnits;
      const occupiedUnits = stats.occupiedUnits;
      const vacantCount = stats.vacantUnits;
      const rate = stats.occupancyRate;

      const vacantList = propertyViews
        .filter((p) => p.property.companyId === targetCompanyId)
        .flatMap((p) =>
          p.units
            .filter((u) => !u.occupant)
            .map((u) => `• **${u.unit.label}** (${p.property.name} · ${u.unit.bedrooms} bed)`)
        );

      return json({
        reply: `**${company.name}** Occupancy Snapshot:\n\n• **Occupancy Rate**: **${rate}%** (${occupiedUnits} of ${totalUnits} units)\n• **Vacant Units**: **${vacantCount}**\n\n${vacantList.length > 0 ? `Available units ready to onboard:\n${vacantList.join('\n')}` : 'All units in this portfolio are currently occupied!'}`,
        type: 'occupancy',
        companyProfile,
        data: { totalUnits, occupiedUnits, vacantCount, rate },
      });
    }

    // 5. Tenant Search (Strictly company-scoped by Name, Unit, or Phone)
    const matchedTenants = tenancies.filter((t) => {
      if (t.tenant.companyId !== targetCompanyId) return false;
      const name = t.tenant.name.toLowerCase();
      const phone = t.tenant.phone.toLowerCase();
      const unit = t.unitLabel.toLowerCase();
      return q.includes(name) || name.split(' ').some((n) => n.length > 2 && q.includes(n)) || q.includes(unit) || q.includes(phone);
    });

    if (matchedTenants.length > 0) {
      const details = matchedTenants
        .map((t) => {
          const b = t.balance;
          const status = b > 0 ? `Owes ${formatKes(b)}` : b < 0 ? `Credit ${formatKes(-b)}` : 'Settled';
          return `### 👤 **${t.tenant.name}**\n• **Unit**: ${t.unitLabel}\n• **Phone**: ${t.tenant.phone}\n• **Monthly Rent**: ${formatKes(t.tenancy.rent)}\n• **Deposit Held**: ${formatKes(t.tenancy.deposit)}\n• **Balance**: **${status}**\n• **Lease**: ${formatDate(t.tenancy.leaseStart)} to ${formatDate(t.tenancy.leaseEnd)}\n• [View Statement](/statement/${t.tenancy.id})`;
        })
        .join('\n\n');

      return json({
        reply: `Found matching tenant profile${matchedTenants.length === 1 ? '' : 's'} in **${company.name}**:\n\n${details}`,
        type: 'tenant',
        companyProfile,
        data: { count: matchedTenants.length, tenants: matchedTenants.map((t) => t.tenant) },
      });
    }

    // 6. Default Portfolio Overview (Strictly company-scoped)
    const activeOpenTickets = repairBoard.open.filter((t) => t.ticket.companyId === targetCompanyId);
    const sampleTenant = tenancies.find((t) => t.tenant.companyId === targetCompanyId && t.isActive)?.tenant.name;

    return json({
      reply: `Here is a live snapshot of **${company.name}** (Company ID: \`${targetCompanyId}\`) for **${currentPeriod}**:\n\n• **Occupancy**: ${stats.occupancyRate}% (${stats.occupiedUnits}/${stats.totalUnits} units)\n• **Collections**: ${stats.collectionRate}% (${formatKes(stats.collectedThisMonth)} collected of ${formatKes(stats.billedThisMonth)} billed)\n• **Arrears**: ${stats.inArrears} tenant${stats.inArrears === 1 ? '' : 's'} owing **${formatKes(stats.overdueAmount)}**\n• **Maintenance**: ${activeOpenTickets.length} open ticket${activeOpenTickets.length === 1 ? '' : 's'}\n\n*You can ask me specifically about arrears, maintenance issues, tenant details${sampleTenant ? ` (such as "Tell me about ${sampleTenant}")` : ''}, or collections!*`,
      type: 'overview',
      companyProfile,
      data: { stats },
    });
  } catch (err: unknown) {
    console.error('Assistant API error:', err);
    return json({ error: 'Failed to process assistant query' }, 500);
  }
};
