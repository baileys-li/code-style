import { test } from 'node:test'

import { RuleTester } from 'eslint'

import rule from './prefer-function-style.js'

const tester = new RuleTester({
	languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('prefer-function-style', () => {
	tester.run('prefer-function-style', rule, {
		valid: [
			// ── Already correct style ────────────────────────────────────────────────

			'function foo() { doA(); doB(); }',
			'async function foo() { await bar(); }',

			// Concise arrows are the target for single-return expressions.
			'const foo = () => value',
			'const foo = (x) => x + 1',
			'const foo = (x) => ({ a: x })',
			'arr.map((x) => x * 2)',

			// ── `this` usage — style change would affect binding ─────────────────────

			'const foo = () => { this.x = 1; }',
			'const foo = function() { return this.x; }',
			'foo = function() { return this.x; }',
			'arr.map(function() { return this.x; })',
			// Inner arrow captures `this` from outer scope — outer is still unsafe to move.
			'const foo = () => { const inner = () => { this.x = 1; }; return inner; }',

			// ── `arguments` / `new.target` — not available inside arrows ──────────────

			'const foo = function() { return arguments[0]; }',
			'arr.map(function() { return arguments.length; })',
			'foo = function() { return new.target; }',
			// `obj.arguments` is just a property name, not the `arguments` object…
			// but a member access alone is not enough reason to keep the function form,
			// so this still converts (see invalid cases).

			// ── Self-referential named function expressions ──────────────────────────
			// The internal name is the only handle on the function; dropping it breaks recursion.

			'const fact = function f(n) { return n <= 1 ? 1 : n * f(n - 1); }',
			'arr.map(function self(x) { return x <= 0 ? x : self(x - 1); })',

			// ── Positions where FunctionExpression cannot become an arrow ────────────

			// Object properties — left to `object-shorthand` rule.
			'const obj = { handler: function() { return 1; } }',
			'const obj = { method() { return 1; } }',

			// Class methods — replacing with an arrow would be a syntax error.
			'class Foo { bar() { return 1; } }',
			'class Foo { static bar() { return 1; } }',

			// Generators in non-declaration positions can't become arrows.
			'foo = function*() { yield 1; }',
			'arr.map(function*() { yield 1; })',

			// ── `var` and reassigned `let` edge cases ────────────────────────────────

			'var foo = () => { return 1; }',

			// Reassigned `let` with arrow init — arrow is already correct, nothing to do.
			'let foo = () => { return 1; }; foo = other;',

			// Multiple declarators — can't cleanly replace with a single declaration.
			'const foo = () => { return 1; }, bar = 2',
		],

		invalid: [
			// ── Single-return named binding → concise arrow ─────────────────────────
			// (body is exactly `{ return <expr>; }` — no reason to use block syntax)

			{
				code: 'const foo = () => { return value; }',
				errors: [{ messageId: 'preferConciseArrow' }],
				output: 'const foo = () => value',
			},
			{
				code: 'const foo = function() { return value; }',
				errors: [{ messageId: 'preferConciseArrow' }],
				output: 'const foo = () => value',
			},
			{
				code: 'const foo = async () => { return await something(); }',
				errors: [{ messageId: 'preferConciseArrow' }],
				output: 'const foo = async () => await something()',
			},
			// Object literal return must be wrapped to avoid `{` being parsed as a block.
			{
				code: 'const foo = () => { return { a: 1 }; }',
				errors: [{ messageId: 'preferConciseArrow' }],
				output: 'const foo = () => ({ a: 1 })',
			},
			// export — only the function node is replaced, export keyword is preserved.
			{
				code: 'export const foo = () => { return 1; }',
				errors: [{ messageId: 'preferConciseArrow' }],
				output: 'export const foo = () => 1',
			},
			// `let` with no reassignment — same treatment as `const`.
			{
				code: 'let foo = () => { return 1; }',
				errors: [{ messageId: 'preferConciseArrow' }],
				output: 'let foo = () => 1',
			},
			{
				code: 'let foo = function() { return 1; }',
				errors: [{ messageId: 'preferConciseArrow' }],
				output: 'let foo = () => 1',
			},

			// ── Multi-statement named binding → function declaration ─────────────────

			{
				code: 'const foo = () => { doA(); return value; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { doA(); return value; }',
			},
			{
				code: 'const foo = () => { doSomething(); }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { doSomething(); }',
			},
			{
				code: 'const foo = function() { doA(); doB(); }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { doA(); doB(); }',
			},
			{
				code: 'const foo = async function() { await doA(); await doB(); }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'async function foo() { await doA(); await doB(); }',
			},
			// Generators stay generators — only the form changes.
			{
				code: 'const foo = function*() { yield 1; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function* foo() { yield 1; }',
			},
			{
				code: 'const foo = (a, b) => { doA(); return a + b; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo(a, b) { doA(); return a + b; }',
			},
			// Internal name of named function expression is dropped.
			{
				code: 'const foo = function bar() { doSomething(); }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { doSomething(); }',
			},
			// `this` only inside an inner FunctionExpression — outer arrow is safe to promote.
			{
				code: 'const foo = () => { const cb = function() { this.x = 1; }; return cb; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { const cb = function() { this.x = 1; }; return cb; }',
			},
			// export multi-statement → export function declaration.
			{
				code: 'export const foo = () => { doSomething(); return 1; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'export function foo() { doSomething(); return 1; }',
			},
			{
				code: 'export const foo = function() { doA(); doB(); }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'export function foo() { doA(); doB(); }',
			},
			// `let` multi-statement with no reassignment — same as `const`.
			{
				code: 'let foo = () => { doA(); return 1; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { doA(); return 1; }',
			},

			// ── Anonymous function expressions → arrow ────────────────────────────────

			{
				code: 'foo = function() { return 1; }',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'foo = () => { return 1; }',
			},
			{
				code: 'foo = async function() { await bar(); }',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'foo = async () => { await bar(); }',
			},
			// `let` reassigned — init can't become a declaration, but can become an arrow.
			{
				code: 'let foo = function() { return 1; }; foo = other;',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'let foo = () => { return 1; }; foo = other;',
			},
			{
				code: 'let foo = () => { return 1; }; foo = function() { return 2; };',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'let foo = () => { return 1; }; foo = () => { return 2; };',
			},
			// Callbacks.
			{
				code: 'arr.map(function(x) { return x * 2; })',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'arr.map((x) => { return x * 2; })',
			},
			// `x.arguments` is a property name, not the `arguments` object — safe to convert.
			{
				code: 'arr.map(function(x) { return x.arguments; })',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'arr.map((x) => { return x.arguments; })',
			},
			{
				code: 'promise.then(function() { doSomething(); })',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'promise.then(() => { doSomething(); })',
			},
			{
				code: 'setTimeout(function() { run(); }, 1000)',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'setTimeout(() => { run(); }, 1000)',
			},
		],
	})
})
