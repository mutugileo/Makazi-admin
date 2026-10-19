import type { APIRoute } from 'astro';
import { getPortfolio, formatKes, formatDate } from '../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const { query } = await request.json();
    if (!query || typeof query !== 'string') {
      return json({ error: 'Query is required' }, 400);
    }

    const q = query.trim().toLowerCase();
    const portfolio = await getPortfolio(user.companyId, cookies);
    const { tenancies, repairBoard, propertyViews, stats, currentPeriod, asOf } = portfolio;

    // 1. Arrears & Overdue Balances
    if (q.includes('arrear') || q.includes('owe') || q.includes('overdue') || q.includes('debt') || q.includes('balance') || q.includes('unpaid')) {
      const owing = tenancies.filter((t) => t.isActive && t.balance > 0);
      const totalArrears = owing.reduce((sum, t) => sum + t.balance, 0);

      if (owing.length === 0) {
        return json({
          reply: `Great news! There are currently **no overdue arrears** across your portfolio for **${currentPeriod}**. All active tenants are up to date.`,
          type: 'arrears',
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
        reply: `You have **${owing.length}** tenant${owing.length === 1 ? '' : 's'} with outstanding arrears totaling **${formatKes(totalArrears)}** as of ${formatDate(asOf)}:\n\n${breakdown}\n\n*Tip: You can use "Send payment reminders" from the header to notify overdue tenants.*`,
        type: 'arrears',
        data: { total: totalArrears, count: owing.length, items },
      });
    }

    // 2. Open Issues & Maintenance
    if (q.includes('issue') || q.includes('maintenance') || q.includes('repair') || q.includes('ticket') || q.includes('fix') || q.includes('broken')) {
      const openCount = repairBoard.open.length;
      const inProgressCount = repairBoard.inProgress.length;
      const resolvedCount = repairBoard.resolved.length;

      const activeTickets = [...repairBoard.open, ...repairBoard.inProgress];

      if (activeTickets.length === 0) {
        return json({
          reply: `All maintenance requests are clear! There are currently **0 open tickets** (${resolvedCount} resolved previously).`,
          type: 'maintenance',
          data: { openCount, inProgressCount, resolvedCount, tickets: [] },
        });
      }

      const list = activeTickets
        .map(
          (t) =>
            `• **${t.ticket.id}**: *${t.ticket.title}* (${t.reporter} · ${t.unitLabel}) — Priority: **${t.priorityLabel}** · Status: **${t.ticket.status}**${t.ticket.assignedTo ? ` · Assigned to: ${t.ticket.assignedTo}` : ''}`
        )
        .join('\n');

      return json({
        reply: `Here are your current active maintenance tickets (**${openCount} open**, **${inProgressCount} in progress**):\n\n${list}\n\n*View full ticket details on the Maintenance board.*`,
        type: 'maintenance',
        data: { openCount, inProgressCount, resolvedCount, tickets: activeTickets.map((t) => t.ticket) },
      });
    }

    // 3. Collections & Revenue
    if (q.includes('collect') || q.includes('revenue') || q.includes('income') || q.includes('payment') || q.includes('mpesa') || q.includes('bank')) {
      const billed = stats.billedThisMonth;
      const collected = stats.collectedThisMonth;
      const rate = stats.collectionRate;
      const count = portfolio.payments.length;

      return json({
        reply: `Financial summary for **${currentPeriod}**:\n\n• **Billed**: ${formatKes(billed)}\n• **Collected**: ${formatKes(collected)}\n• **Collection Rate**: **${rate}%**\n• **Total Transactions**: ${count} payment records\n• **Deposits Held**: ${formatKes(stats.depositsHeld)} (held, not counted as revenue)`,
        type: 'collections',
        data: { billed, collected, rate, depositsHeld: stats.depositsHeld },
      });
    }

    // 4. Vacant Units
    if (q.includes('vacant') || q.includes('empty') || q.includes('occupan') || q.includes('available')) {
      const totalUnits = stats.totalUnits;
      const occupiedUnits = stats.occupiedUnits;
      const vacantCount = stats.vacantUnits;
      const rate = stats.occupancyRate;

      const vacantList = propertyViews.flatMap((p) =>
        p.units
          .filter((u) => !u.occupant)
          .map((u) => `• **${u.unit.label}** (${p.property.name} · ${u.unit.bedrooms} bed)`)
      );

      return json({
        reply: `Portfolio Occupancy:\n\n• **Occupancy Rate**: **${rate}%** (${occupiedUnits} of ${totalUnits} units)\n• **Vacant Units**: **${vacantCount}**\n\n${vacantList.length > 0 ? `Available units ready to onboard:\n${vacantList.join('\n')}` : 'All units are currently occupied!'}`,
        type: 'occupancy',
        data: { totalUnits, occupiedUnits, vacantCount, rate },
      });
    }

    // 5. Tenant Search (by Name, Unit, or Phone)
    const matchedTenants = tenancies.filter((t) => {
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
        reply: `Found matching tenant profile${matchedTenants.length === 1 ? '' : 's'}:\n\n${details}`,
        type: 'tenant',
        data: { count: matchedTenants.length, tenants: matchedTenants.map((t) => t.tenant) },
      });
    }

    // 6. Default Portfolio Pulse Overview
    return json({
      reply: `Here is a live snapshot of **${portfolio.company.name}** for **${currentPeriod}**:\n\n• **Occupancy**: ${stats.occupancyRate}% (${stats.occupiedUnits}/${stats.totalUnits} units)\n• **Collections**: ${stats.collectionRate}% (${formatKes(stats.collectedThisMonth)} collected of ${formatKes(stats.billedThisMonth)} billed)\n• **Arrears**: ${stats.inArrears} tenant${stats.inArrears === 1 ? '' : 's'} owing **${formatKes(stats.overdueAmount)}**\n• **Maintenance**: ${repairBoard.open.length} open ticket${repairBoard.open.length === 1 ? '' : 's'}\n\n*You can ask me specifically about arrears, maintenance issues, tenant details (such as "Tell me about Wanjiku"), or collections!*`,
      type: 'overview',
      data: { stats },
    });
  } catch (err: unknown) {
    console.error('Assistant API error:', err);
    return json({ error: 'Failed to process assistant query' }, 500);
  }
};
