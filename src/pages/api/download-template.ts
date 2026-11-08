import type { APIRoute } from 'astro';

const SAMPLE_CSV = `Property Name,Property Type,Account Prefix,Water Rate (KES/m3),Garbage Fee (KES/mo),Address,Unit Label,Bedrooms,Monthly Rent (KES),Deposit (KES),Listed,Tenant Name,Tenant Phone,Tenant Email,Move In Date,Opening Balance,Opening Water Reading
Kilimani Heights,apartments,KH,150,500,Argwings Kodhek Rd,A1,1,35000,35000,no,Grace Wanjiku,0712345678,grace.w@gmail.com,2024-01-01,0,45
Kilimani Heights,apartments,KH,150,500,Argwings Kodhek Rd,A2,2,55000,55000,no,Kevin Ochieng,0723456789,kevin.o@gmail.com,2024-02-15,0,82
Kilimani Heights,apartments,KH,150,500,Argwings Kodhek Rd,A3,1,35000,35000,yes,,,,,,
Kilimani Heights,apartments,KH,150,500,Argwings Kodhek Rd,B1,2,55000,55000,yes,,,,,,
Riverside Villas,houses,RV,180,1000,Riverside Dr,Villa 1,4,120000,120000,no,David Mutua,0798765432,david.m@outlook.com,2023-11-01,0,110
Riverside Villas,houses,RV,180,1000,Riverside Dr,Villa 2,4,120000,120000,yes,,,,,,
`;

const BLANK_CSV = `Property Name,Property Type,Account Prefix,Water Rate (KES/m3),Garbage Fee (KES/mo),Address,Unit Label,Bedrooms,Monthly Rent (KES),Deposit (KES),Listed,Tenant Name,Tenant Phone,Tenant Email,Move In Date,Opening Balance,Opening Water Reading
`;

export const GET: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(request.url);
  const isBlank = url.searchParams.get('type') === 'blank';
  const csvContent = isBlank ? BLANK_CSV : SAMPLE_CSV;
  const filename = isBlank 
    ? 'makazi_bulk_property_blank_template.csv' 
    : 'makazi_bulk_property_template.csv';

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    },
  });
};
