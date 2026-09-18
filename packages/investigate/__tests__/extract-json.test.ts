import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/llm';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a ```json fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips a bare ``` fence', () => {
    expect(extractJson('```\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it('recovers JSON with leading prose', () => {
    expect(extractJson('Here is the plan:\n[{"title":"x"}]')).toEqual([{ title: 'x' }]);
  });

  it('recovers JSON with trailing prose', () => {
    expect(extractJson('[{"title":"x"}]\nLet me know if you need changes.')).toEqual([{ title: 'x' }]);
  });

  it('recovers JSON with both leading and trailing prose', () => {
    expect(extractJson('Sure, here:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  it('throws a descriptive error on genuinely unparseable output', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/Could not parse JSON/);
  });
});
