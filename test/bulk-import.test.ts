import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningBalance, validateBulkCsv } from '../src/lib/bulk-import.ts';

describe('parseOpeningBalance', () => {
  const cases: [string, number | null][] = [
    ['31,700', 31700],
    ['0', 0],
    ['-5,000', -5000],
    ['(5,000)', -5000],
    ['5,000 CR', -5000],
    ['5,000 cr.', -5000],
    ['5,000 DR', 5000],
    ['−200', -200],
    ['KES 1,250', 1250],
    ['  800  ', 800],
    ['abc', null],
    ['12abc', null],
    ['', null],
    ['   ', null],
  ];
  for (const [raw, expected] of cases) {
    test(`'${raw}' → ${expected}`, () => assert.equal(parseOpeningBalance(raw), expected));
  }

  test("'1500cr' → -1500 (CR written straight after the number)", () => {
    assert.equal(parseOpeningBalance('1500cr'), -1500);
  });
  test("'1500dr' → 1500", () => {
    assert.equal(parseOpeningBalance('1500dr'), 1500);
  });
});

const HEADER =
  'Property Name,Type,Account Prefix,Water Rate,Garbage Fee,Address,Unit Label,Bedrooms,Monthly Rent (KES),Deposit,Is Listed,Tenant Name,Tenant Phone,Tenant Email,Move In Date,Move In Rent,Opening Balance,Opening Water Reading';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

const GOOD_ROW = 'Sunrise Court,apartments,SC,120,300,Ngong Rd,A1,2,"25,000",30000,,Jane Wanjiru,0712 345 678,jane@mail.test,2026-09-01,12500,"(1,500)",345';

describe('validateBulkCsv', () => {
  test('a good CSV passes with its values preserved', () => {
    const result = validateBulkCsv(csv(GOOD_ROW, 'Sunrise Court,apartments,SC,120,300,Ngong Rd,A2,1,18000,,yes,,,,,,,'));
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
    assert.equal(result.rows.length, 2);
    const [let1, vacant] = result.rows;
    assert.equal(let1.rowNumber, 2);
    assert.equal(let1.propertyName, 'Sunrise Court');
    assert.equal(let1.propertyType, 'apartments');
    assert.equal(let1.accountPrefix, 'SC');
    assert.equal(let1.waterRate, 120);
    assert.equal(let1.garbageFee, 300);
    assert.equal(let1.unitLabel, 'A1');
    assert.equal(let1.bedrooms, 2);
    assert.equal(let1.rent, 25000);
    assert.equal(let1.deposit, 30000);
    assert.equal(let1.isListed, false);
    assert.equal(let1.tenantName, 'Jane Wanjiru');
    assert.equal(let1.tenantPhone, '0712345678');
    assert.equal(let1.tenantEmail, 'jane@mail.test');
    assert.equal(let1.moveInDate, '2026-09-01');
    assert.equal(let1.moveInRent, 12500);
    assert.equal(let1.openingBalance, -1500);
    assert.equal(let1.openingReading, 345);

    assert.equal(vacant.deposit, 18000, 'blank deposit defaults to one month');
    assert.equal(vacant.isListed, true);
    assert.equal(vacant.tenantName, undefined);
    assert.equal(vacant.openingReading, null);

    assert.equal(result.summary.propertiesCount, 1);
    assert.equal(result.summary.unitsCount, 2);
    assert.equal(result.summary.tenanciesCount, 1);
    assert.equal(result.summary.totalMonthlyRent, 43000);
  });

  test('header aliases are accepted', () => {
    const result = validateBulkCsv('Property,Unit,Rent\nBlock B,1,9000');
    assert.equal(result.valid, true);
    assert.equal(result.rows[0].rent, 9000);
  });

  test('a bad move-in date is a row error', () => {
    const result = validateBulkCsv(csv(GOOD_ROW.replace('2026-09-01', '01/09/2026')));
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[2, 'moveInDate']]);
  });

  test('a bad opening balance is a row error', () => {
    const result = validateBulkCsv(csv(GOOD_ROW.replace('"(1,500)"', 'owes a lot')));
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[2, 'openingBalance']]);
  });

  test('a bad opening reading is a row error', () => {
    const result = validateBulkCsv(csv(GOOD_ROW.replace(/,345$/, ',none')));
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[2, 'openingReading']]);
  });

  test('a missing Monthly Rent column is one file-level error', () => {
    const result = validateBulkCsv('Property Name,Unit Label\nBlock B,1');
    assert.equal(result.valid, false);
    assert.equal(result.rows.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].row, 1);
    assert.equal(result.errors[0].field, 'csv');
    assert.match(result.errors[0].message, /Missing column: Monthly Rent \(KES\)/);
  });

  test('a header with no data rows is an error', () => {
    const result = validateBulkCsv(HEADER);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].field, 'csv');
  });

  test('a unit repeated in the same property is an error on the second row', () => {
    const result = validateBulkCsv('Property Name,Unit Label,Monthly Rent\nBlock B,A1,9000\nblock b,a1,9500\nBlock C,A1,9000');
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[3, 'unitLabel']]);
    assert.match(result.errors[0].message, /Duplicate unit/);
  });

  test('a missing or zero rent is a row error', () => {
    const result = validateBulkCsv('Property Name,Unit Label,Monthly Rent\nBlock B,A1,\nBlock B,A2,0');
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[2, 'rent'], [3, 'rent']]);
  });

  test('an invalid phone is a row error', () => {
    const result = validateBulkCsv(csv(GOOD_ROW.replace('0712 345 678', '12345')));
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[2, 'tenantPhone']]);
  });

  // Reported, not fixed: the date check is format-only, so an impossible date
  // passes validation and reaches the database (or cycleOf) as-is.
  test('an impossible move-in date is a row error', () => {
    const result = validateBulkCsv(csv(GOOD_ROW.replace('2026-09-01', '2026-13-45')));
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[2, 'moveInDate']]);
  });

  // Reported, not fixed: the reading parser strips '-', so -50 is accepted as 50.
  test('a negative opening reading is a row error', () => {
    const result = validateBulkCsv(csv(GOOD_ROW.replace(/,345$/, ',-50')));
    assert.deepEqual(result.errors.map((e) => [e.row, e.field]), [[2, 'openingReading']]);
  });
});
