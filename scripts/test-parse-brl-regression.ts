import { parseBRL, formatCurrencyInput } from '../src/lib/utils';

function assert(c: boolean, m: string) {
  if (!c) {
    console.error('FAIL:', m);
    process.exit(1);
  }
  console.log('PASS:', m);
}

assert(parseBRL("5000") === 5000.00, '5000 => 5000.00');
assert(parseBRL("5.000") === 5000.00, '5.000 => 5000.00');
assert(parseBRL("5.000,00") === 5000.00, '5.000,00 => 5000.00');
assert(parseBRL("5000,50") === 5000.50, '5000,50 => 5000.50');
assert(parseBRL("5.000,50") === 5000.50, '5.000,50 => 5000.50');
assert(parseBRL("R$ 5.000,00") === 5000.00, 'R$ 5.000,00 => 5000.00');
assert(parseBRL("50.000,00") === 50000.00, '50.000,00 => 50000.00');

// Bug regression:
assert(parseBRL("5000") !== 50.00, '5000 MUST NOT BE 50.00');

// Blur formatting:
assert(formatCurrencyInput(parseBRL("5000")) === "5.000,00", 'formatCurrencyInput(5000) => 5.000,00');

console.log('ALL PARSE BRL TESTS PASSED!');
