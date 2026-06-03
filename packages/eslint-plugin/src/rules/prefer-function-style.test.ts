import { test } from 'node:test'

import { RuleTester } from 'eslint'

import rule from './prefer-function-style.js'

const tester = new RuleTester({
	languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

test('prefer-function-style', () => {
	tester.run('prefer-function-style', rule, {
		valid: [
			// Concise arrows (implicit return) are allowed everywhere.
			'const foo = () => value',
			'const foo = (x) => x + 1',
			'const foo = (x) => ({ a: x })',

			// Already a function declaration — nothing to do.
			'function foo() {}',

			// `this` in the function body — changing style would affect binding.
			'const foo = () => { this.x = 1; }',
			'const foo = function() { return this.x; }',
			'foo = function() { return this.x; }',

			// `this` captured through inner arrow — still refers to outer context.
			'const foo = () => { const inner = () => { this.x = 1; }; return inner; }',

			// `var` is always skipped — function-scoped hoisting diverges from
			// block-scoped `function` declaration in strict mode.
			'var foo = () => { return 1; }',

			// `let` reassigned with a non-function — init is already an arrow, nothing to do.
			'let foo = () => { return 1; }; foo = other;',

			// Generators in assignment expressions can't become arrows.
			'foo = function*() { yield 1; }',

			// Multiple declarators in one statement — can't cleanly replace.
			'const foo = () => { return 1; }, bar = 2',
		],

		invalid: [
			// ── const/let (not reassigned) → function declaration ──────────────────

			{
				code: 'const foo = () => { return value; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { return value; }',
			},
			{
				code: 'const foo = function() { return value; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { return value; }',
			},
			// Internal name of named function expression is dropped.
			{
				code: 'const foo = function bar() { return 1; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { return 1; }',
			},
			{
				code: 'const foo = async () => { await something(); }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'async function foo() { await something(); }',
			},
			{
				code: 'const foo = async function() { await something(); }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'async function foo() { await something(); }',
			},
			{
				code: 'const foo = function*() { yield 1; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function* foo() { yield 1; }',
			},
			{
				code: 'const foo = x => { return x; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo(x) { return x; }',
			},
			{
				code: 'const foo = (a, b) => { return a + b; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo(a, b) { return a + b; }',
			},
			// `this` only inside an inner FunctionExpression — outer arrow is safe to convert.
			{
				code: 'const foo = () => { const cb = function() { this.x = 1; }; return cb; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { const cb = function() { this.x = 1; }; return cb; }',
			},
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
			// `let` with no reassignment — same as `const`.
			{
				code: 'let foo = () => { return 1; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { return 1; }',
			},
			{
				code: 'let foo = function() { return 1; }',
				errors: [{ messageId: 'preferFunctionDeclaration' }],
				output: 'function foo() { return 1; }',
			},

			// ── anonymous FunctionExpression as a value → arrow ─────────────────────

			// Assignment expression.
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
			// `let` reassigned later — init can't become a declaration, but can become an arrow.
			{
				code: 'let foo = function() { return 1; }; foo = other;',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'let foo = () => { return 1; }; foo = other;',
			},
			// Both the init and the reassignment are function expressions.
			{
				code: 'let foo = () => { return 1; }; foo = function() { return 2; };',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'let foo = () => { return 1; }; foo = () => { return 2; };',
			},
		],
	})
})
