// Static report list. Everything else (tenants, bills, payments, repairs,
// messages) is derived from shared/billing-seed.json in ./portfolio.ts.

export const dashboardData = {
  reportsList: [
    { id: 'rep-0', title: 'Monthly bills', description: 'The owner\'s spreadsheet: rent, water, garbage, balance b/f, paid and outstanding. Export to Excel.', href: '/bills' },
    { id: 'rep-1', title: 'Rent roll', description: 'Every unit with tenant, rent, deposit and move-in date.' },
    { id: 'rep-2', title: 'Collections summary', description: 'Expected vs collected per property, split by M-Pesa and bank.' },
    { id: 'rep-3', title: 'Arrears ageing', description: 'Outstanding balances grouped by days overdue.' },
    { id: 'rep-4', title: 'Occupancy & vacancy', description: 'Occupied and vacant units, move-ins and move-outs.' },
    { id: 'rep-5', title: 'Maintenance log', description: 'Requests, response times and costs by property.' },
    { id: 'rep-6', title: 'Landlord statement', description: 'Monthly owner statement with deductions and payouts.' },
  ],
};
