import { describe, it, expect } from 'vitest';
import { computeServiceStatus } from '../lib/status';

describe('computeServiceStatus', () => {
  it('is ok with no investigation at all', () => {
    expect(computeServiceStatus(null)).toBe('ok');
  });

  it('is at-risk while an investigation is still running or queued', () => {
    expect(computeServiceStatus({ status: 'queued', priority: null })).toBe('at-risk');
    expect(computeServiceStatus({ status: 'running', priority: null })).toBe('at-risk');
  });

  it('is critical for a completed P1', () => {
    expect(computeServiceStatus({ status: 'completed', priority: 'P1' })).toBe('critical');
  });

  it('is at-risk for a completed P2 or P3', () => {
    expect(computeServiceStatus({ status: 'completed', priority: 'P2' })).toBe('at-risk');
    expect(computeServiceStatus({ status: 'completed', priority: 'P3' })).toBe('at-risk');
  });

  it('is ok for a completed informational result', () => {
    expect(computeServiceStatus({ status: 'completed', priority: 'informational' })).toBe('ok');
  });

  it('is ok for a failed investigation (the exposure claim itself did not stand up)', () => {
    expect(computeServiceStatus({ status: 'failed', priority: null })).toBe('ok');
  });
});
