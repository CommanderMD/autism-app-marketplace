// Money Bingo item set: the 15 things that appear on every board and in the
// call deck. Every board holds all 15, once each, in a seeded order.
//
// ITEM SHAPE
//   { id: 'penny', audio: 'penny', svg: 'penny' }
//   id     stable key; also the i18n key moneyBingo.items.<id>
//   audio  the English spoken label (the fallback when a translation is
//          missing); the shell speaks t('moneyBingo.items.<id>')
//   svg    key into ./money-svg.js
//
// No imports here, so money-svg.js can validate against this list at load
// without a cycle.

const item = (id, audio, svg = id) => Object.freeze({ id, audio, svg });

export const ITEMS = Object.freeze([
  // coins
  item('penny', 'penny'),
  item('nickel', 'nickel'),
  item('dime', 'dime'),
  item('quarter', 'quarter'),
  // bills
  item('one-dollar', 'one dollar bill'),
  item('five-dollars', 'five dollar bill'),
  item('ten-dollars', 'ten dollar bill'),
  item('twenty-dollars', 'twenty dollar bill'),
  // symbols
  item('dollar-sign', 'dollar sign'),
  item('cent-sign', 'cent sign'),
  // concepts
  item('wallet', 'wallet'),
  item('purse', 'purse'),
  item('piggy-bank', 'piggy bank'),
  item('spend', 'spend'),
  item('save', 'save'),
]);

export const ITEM_IDS = Object.freeze(ITEMS.map((i) => i.id));

export function itemById(id) {
  return ITEMS.find((i) => i.id === id) || null;
}
