import { describe, it, expect } from 'vitest';
import {
  createGCounter,
  increment,
  merge,
  applyDelta,
  value,
  serializeDelta,
  deserializeDelta,
} from '../lib/delta-crdt.js';

describe('GCounter — createGCounter', () => {
  it('initialises at zero', () => {
    expect(value(createGCounter('node-a'))).toBe(0);
  });

  it('stores the nodeId', () => {
    expect(createGCounter('node-a').nodeId).toBe('node-a');
  });
});

describe('GCounter — increment', () => {
  it('increments the local node count by 1', () => {
    const [next] = increment(createGCounter('node-a'));
    expect(value(next)).toBe(1);
  });

  it('does not mutate the original counter', () => {
    const original = createGCounter('node-a');
    increment(original);
    expect(value(original)).toBe(0);
  });

  it('returns a delta containing only the incremented node', () => {
    const [, delta] = increment(createGCounter('node-a'));
    expect(delta.increments.size).toBe(1);
    expect(delta.increments.get('node-a')).toBe(1);
  });

  it('delta carries the new absolute value, not a relative diff', () => {
    const [c1] = increment(createGCounter('node-a'));
    const [, delta] = increment(c1);
    expect(delta.increments.get('node-a')).toBe(2);
  });
});

describe('GCounter — merge', () => {
  it('sums contributions from two nodes', () => {
    const [a] = increment(createGCounter('node-a'));
    const [b] = increment(createGCounter('node-b'));
    expect(value(merge(a, b))).toBe(2);
  });

  it('is commutative: merge(a,b) === merge(b,a)', () => {
    const [a1] = increment(createGCounter('node-a'));
    const [a2] = increment(a1);
    const [b1] = increment(createGCounter('node-b'));
    expect(value(merge(a2, b1))).toBe(value(merge(b1, a2)));
  });

  it('is idempotent: merge(a, a) === a', () => {
    const [c] = increment(createGCounter('node-a'));
    expect(value(merge(c, c))).toBe(1);
  });

  it('takes the max for concurrent updates to the same node', () => {
    const base = createGCounter('node-a');
    const [branch1] = increment(base);
    const [branch2] = increment(branch1);
    const [concurrent] = increment(base);
    expect(value(merge(branch2, concurrent))).toBe(2);
  });
});

describe('GCounter — applyDelta', () => {
  it('applies an incoming delta to a remote counter', () => {
    const local = createGCounter('node-a');
    const remote = createGCounter('node-b');
    const [, delta] = increment(remote);
    expect(value(applyDelta(local, delta))).toBe(1);
  });

  it('is idempotent: applying the same delta twice changes nothing', () => {
    const local = createGCounter('node-a');
    const [, delta] = increment(createGCounter('node-b'));
    const once = applyDelta(local, delta);
    expect(value(applyDelta(once, delta))).toBe(1);
  });

  it('never decrements: stale delta with lower value is ignored', () => {
    const [c1] = increment(createGCounter('node-a'));
    const [c2] = increment(c1);
    const [, stale] = increment(createGCounter('node-a')); // value=1, behind c2
    expect(value(applyDelta(c2, stale))).toBe(2);
  });
});

describe('GCounter — serialization', () => {
  it('round-trips a delta through JSON without data loss', () => {
    const [, delta] = increment(createGCounter('node-a'));
    const restored = deserializeDelta(serializeDelta(delta));
    expect(Object.fromEntries(restored.increments)).toEqual(
      Object.fromEntries(delta.increments),
    );
  });

  it('preserves numeric values after JSON parse', () => {
    const [c1] = increment(createGCounter('node-x'));
    const [, delta] = increment(c1);
    const restored = deserializeDelta(serializeDelta(delta));
    expect(restored.increments.get('node-x')).toBe(2);
  });
});
