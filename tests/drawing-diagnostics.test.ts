import test from 'node:test';
import assert from 'node:assert/strict';
import { timingDistribution } from '../app/shared/drawing-diagnostics.ts';
test('small capture distributions retain outliers with nearest-rank percentiles', () => {
  assert.deepEqual(timingDistribution([]), {count:0,p50Ms:0,p95Ms:0,p99Ms:0,maxMs:0,over17ms:0,over50ms:0});
  const values=[16.7,16.7,16.7,16.7,16.7,16.7,16.7,16.7,16.7,732.1];
  assert.equal(timingDistribution(values).p95Ms,732.1);
  assert.equal(timingDistribution(values).over50ms,1);
  assert.deepEqual(values.at(-1),732.1);
});
