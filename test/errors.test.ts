import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from '../src/lib/errors.ts';

// errorMessage logs mapped database errors on the server; keep test output clean.
const quiet = <T>(fn: () => T): T => {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
};

const FALLBACK = "Couldn't save. Try again.";

test('22023 and P0001 messages are written for people and pass through', () => {
  assert.equal(errorMessage({ code: '22023', message: 'Rent must be above zero.' }), 'Rent must be above zero.');
  assert.equal(errorMessage({ code: 'P0001', message: 'That unit is already let.' }), 'That unit is already let.');
});

test('22023 with an empty message falls back', () => {
  assert.equal(errorMessage({ code: '22023', message: '' }), FALLBACK);
});

test('known database codes map to friendly copy and never leak the raw message', () => {
  const raw = 'duplicate key value violates unique constraint "units_property_id_label_key"';
  const cases: Record<string, string> = {
    '23505': 'That already exists. Check for a duplicate.',
    '23503': "That record is linked to something else and can't be changed.",
    '23514': "That value isn't allowed. Check the details and try again.",
    '42501': "You don't have access to that.",
  };
  for (const [code, expected] of Object.entries(cases)) {
    const message = quiet(() => errorMessage({ code, message: raw }));
    assert.equal(message, expected, code);
    assert.ok(!message.includes('constraint'), code);
  }
});

test('unknown database codes and missing codes use the fallback', () => {
  assert.equal(quiet(() => errorMessage({ code: '42P01', message: 'relation "x" does not exist' })), FALLBACK);
  assert.equal(quiet(() => errorMessage({ message: 'something odd' })), FALLBACK);
  assert.equal(quiet(() => errorMessage({ code: 'XX000', message: 'boom' }, 'Couldn’t record payment.')), 'Couldn’t record payment.');
});

test('non-objects use the fallback', () => {
  assert.equal(errorMessage(null), FALLBACK);
  assert.equal(errorMessage(undefined), FALLBACK);
  assert.equal(errorMessage('a string'), FALLBACK);
  assert.equal(errorMessage({ code: '23505' }), FALLBACK);
});

test('Error instances pass their message through (server-thrown, written for people)', () => {
  assert.equal(errorMessage(new Error('Choose a unit.')), 'Choose a unit.');
  assert.equal(errorMessage(new Error('')), FALLBACK);
});

// Possible gap, reported rather than fixed here: postgrest-js 2.117 builds its
// errors as `class PostgrestError extends Error` for `.throwOnError()` and for
// transport failures ("TypeError: fetch failed"). The `instanceof Error` branch
// runs first, so such an error skips the code mapping and its raw message
// (constraint names included) reaches the screen. Correct behaviour: map by
// code before trusting an Error's message.
test('an Error carrying a database code is mapped like a plain error object', () => {
  class FakePostgrestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  const err = new FakePostgrestError('duplicate key value violates unique constraint "units_label_key"', '23505');
  assert.equal(quiet(() => errorMessage(err)), 'That already exists. Check for a duplicate.');
});
