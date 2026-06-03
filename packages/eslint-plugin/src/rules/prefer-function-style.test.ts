import { test } from 'node:test';
import { RuleTester } from 'eslint';
import rule from './prefer-function-style.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

test('prefer-function-style', () => {
  tester.run('prefer-function-style', rule, {
    valid: [
      // Concise arrows (implicit return) are allowed.
      'const foo = () => value',
      'const foo = (x) => x + 1',
      'const foo = (x) => ({ a: x })',

      // Already a function declaration — nothing to do.
      'function foo() {}',

      // `this` in the function body — changing style would affect binding.
      'const foo = () => { this.x = 1; }',
      'const foo = function() { return this.x; }',

      // `this` captured through inner arrow — still refers to outer context.
      'const foo = () => { const inner = () => { this.x = 1; }; return inner; }',

      // `this` inside nested non-arrow function is that function's own `this` —
      // but the outer arrow still needs to be preserved because it captures
      // *nothing*... actually this is safe to convert. The inner FunctionExpression
      // rebinds `this`, so the outer arrow's `this` usage is irrelevant here.
      // Covered separately in the invalid section.

      // `let`/`var` are skipped — variable may be reassigned.
      'let foo = () => { return 1; }',
      'var foo = () => { return 1; }',

      // Multiple declarators in one statement — can't cleanly replace.
      'const foo = () => { return 1; }, bar = 2',
    ],

    invalid: [
      // Block-body arrow → function declaration.
      {
        code: 'const foo = () => { return value; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'function foo() { return value; }',
      },
      // Named function expression → function declaration.
      {
        code: 'const foo = function() { return value; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'function foo() { return value; }',
      },
      // Named function expression with internal name — internal name is dropped.
      {
        code: 'const foo = function bar() { return 1; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'function foo() { return 1; }',
      },
      // async arrow.
      {
        code: 'const foo = async () => { await something(); }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'async function foo() { await something(); }',
      },
      // async function expression.
      {
        code: 'const foo = async function() { await something(); }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'async function foo() { await something(); }',
      },
      // Generator function expression.
      {
        code: 'const foo = function*() { yield 1; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'function* foo() { yield 1; }',
      },
      // Single-param arrow without parens.
      {
        code: 'const foo = x => { return x; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'function foo(x) { return x; }',
      },
      // Multi-param arrow.
      {
        code: 'const foo = (a, b) => { return a + b; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'function foo(a, b) { return a + b; }',
      },
      // `this` is only inside an inner FunctionExpression, not in the outer arrow —
      // safe to convert the outer arrow.
      {
        code: 'const foo = () => { const cb = function() { this.x = 1; }; return cb; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'function foo() { const cb = function() { this.x = 1; }; return cb; }',
      },
      // export const → export function.
      {
        code: 'export const foo = () => { return 1; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'export function foo() { return 1; }',
      },
      {
        code: 'export const foo = function() { return 1; }',
        errors: [{ messageId: 'preferFunctionDeclaration' }],
        output: 'export function foo() { return 1; }',
      },
    ],
  });
});
