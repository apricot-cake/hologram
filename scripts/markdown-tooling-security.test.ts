import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function probe(source: string, timeout = 5000) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout }));
}

describe('Markdown の依存更新', () => {
  it('継承された trust では危険なリンクを許可せず、通常の数式と明示指定を保つ', () => {
    const result = probe(`
      import katex from 'katex';
      const expression = String.raw\`\\href{javascript:alert(1)}{x}\`;
      Object.defineProperty(Object.prototype, 'trust', { value: true, writable: true, configurable: true });
      try {
        console.log(JSON.stringify({
          polluted: katex.renderToString(expression, {}).includes('href="javascript:'),
          inherited: katex.renderToString(expression, Object.create({ trust: true })).includes('href="javascript:'),
          explicit: katex.renderToString(expression, { trust: true }).includes('href="javascript:'),
          normal: katex.renderToString('x^2', {}).includes('<math'),
        }));
      } finally { delete Object.prototype.trust; }
    `);
    expect(result).toEqual({ polluted: false, inherited: false, explicit: true, normal: true });
  });

  it('多数の TOML キーを制限時間内に解析する', () => {
    const result = probe(`
      import { parse } from 'smol-toml';
      const count = 256000;
      const input = Array.from({ length: count }, (_, i) => 'k' + i + '=1').join('\\n');
      console.log(JSON.stringify({ count: Object.keys(parse(input)).length }));
    `);
    expect(result.count).toBe(256000);
  });

  it('既存方式の設定で長さ・無効化・警告レベルを維持する', () => {
    const result = probe(`
      import { lint } from 'markdownlint/sync';
      const config = { default: false, MD013: { line_length: 120, severity: 'warning' } };
      const run = (config, length) => lint({ strings: { fixture: 'x '.repeat(length).trim() + '\\n' }, config }).fixture;
      const allowed = run(config, 50);
      const warning = run(config, 80);
      config.MD013.enabled = false;
      const disabled = run(config, 80);
      const json = run({ default: false, MD013: { line_length: 120 } }, 50);
      console.log(JSON.stringify({ allowed, warning, disabled, json }));
    `);
    expect(result.allowed).toEqual([]);
    expect(result.disabled).toEqual([]);
    expect(result.json).toEqual([]);
    expect(result.warning).toHaveLength(1);
    expect(result.warning[0]).toMatchObject({ severity: 'warning', errorDetail: 'Expected: 120; Actual: 159' });
  });
});
