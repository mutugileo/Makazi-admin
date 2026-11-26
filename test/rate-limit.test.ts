import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLockedOut, recordFailure, clearFailures } from '../src/lib/auth/rate-limit.ts';

test('5 failures for one email from one IP lock that pair only', () => {
  for (let i = 0; i < 5; i++) recordFailure('owner@a.test', '10.0.0.1');
  assert.equal(isLockedOut('owner@a.test', '10.0.0.1').locked, true);
  // The real owner signing in from elsewhere is not locked out by someone else's guesses.
  assert.equal(isLockedOut('owner@a.test', '10.0.0.2').locked, false);
});

test('a successful sign-in clears the pair', () => {
  for (let i = 0; i < 5; i++) recordFailure('clear@a.test', '10.0.0.3');
  clearFailures('clear@a.test', '10.0.0.3');
  assert.equal(isLockedOut('clear@a.test', '10.0.0.3').locked, false);
});

test('20 failures from one IP lock that IP for any email', () => {
  for (let i = 0; i < 20; i++) recordFailure(`spray${i}@a.test`, '10.0.0.4');
  assert.equal(isLockedOut('someone-else@a.test', '10.0.0.4').locked, true);
});

test('spread-out guessing on one email is stopped at 50', () => {
  for (let i = 0; i < 50; i++) recordFailure('target@a.test', `10.1.${Math.floor(i / 4)}.${i % 4}`);
  assert.equal(isLockedOut('target@a.test', '10.9.9.9').locked, true);
});
