import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedEffect } from '../public/js/theme-effects.js';

test('snow works over the standard theme and overrides another theme effect', () => {
  assert.equal(selectedEffect(null, { snowflakes: true }), 'snow');
  assert.equal(selectedEffect({ effect: 'hearts' }, { snowflakes: true }), 'snow');
});
test('snow can be disabled without suppressing other effects', () => {
  assert.equal(selectedEffect({ effect: 'snow' }, { snowflakes: false }), 'none');
  assert.equal(selectedEffect({ effect: 'hearts' }, { snowflakes: false }), 'hearts');
  assert.equal(selectedEffect({ effect: 'snow' }, {}), 'snow');
});
test('reduced motion and the global effect switch take precedence over snow', () => {
  assert.equal(selectedEffect({ effect: 'snow' }, { snowflakes: true, reduceMotion: true }), 'none');
  assert.equal(selectedEffect({ effect: 'snow' }, { snowflakes: true, themeFx: false }), 'none');
});
