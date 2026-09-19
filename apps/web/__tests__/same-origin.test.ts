import { describe, it, expect } from 'vitest';
import { isSameOrigin } from '../lib/same-origin';

describe('isSameOrigin (guards the demo reset)', () => {
  it('accepts a request from this site', () => {
    expect(isSameOrigin('https://detroit-cyber-ready-web.vercel.app', 'detroit-cyber-ready-web.vercel.app')).toBe(true);
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
  });

  it('rejects another site', () => {
    expect(isSameOrigin('https://evil.example', 'detroit-cyber-ready-web.vercel.app')).toBe(false);
  });

  it('rejects a lookalike host', () => {
    expect(isSameOrigin('https://detroit-cyber-ready-web.vercel.app.evil.example', 'detroit-cyber-ready-web.vercel.app')).toBe(false);
  });

  it('rejects a missing or malformed Origin', () => {
    expect(isSameOrigin(null, 'localhost:3000')).toBe(false);
    expect(isSameOrigin('null', 'localhost:3000')).toBe(false);
    expect(isSameOrigin('not a url', 'localhost:3000')).toBe(false);
  });
});
