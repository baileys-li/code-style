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

			// Function declarations are the target form for named bindings.
			'function foo() {}',
			'async function foo() { await bar(); }',

			// Concise arrows are the target form for implicit-return expressions.
			'const foo = () => value',
			'const foo = (x) => x + 1',
			'const foo = (x) => ({ a: x })',
			'arr.map((x) => x * 2)',

			// ── `this` usage — style change would affect binding ─────────────────────

			'const foo = () => { this.x = 1; }',
			'const foo = function() { return this.x; }',
			'foo = function() { return this.x; }',
			'arr.map(function() { return this.x; })',
			// `this` captured through inner arrow still belongs to the outer scope.
			'const foo = () => { const inner = () => { this.x = 1; }; return inner; }',

			// ── Positions where FunctionExpression cannot become an arrow ────────────

			// Method shorthands: replacing the FunctionExpression would be a syntax error.
			'const obj = { method() { return 1; } }',
			'class Foo { bar() { return 1; } }',
			'class Foo { static bar() { return 1; } }',

			// Generators cannot be expressed as arrows.
			'foo = function*() { yield 1; }',
			'arr.map(function*() { yield 1; })',
			// Generator in a named declaration CAN become a function declaration (invalid section).

			// ── `var` and reassigned `let` edge cases ────────────────────────────────

			// `var` is always skipped — function-scoped hoisting differs from
			// block-scoped `function` declaration in strict mode.
			'var foo = () => { return 1; }',

			// Reassigned `let` with non-function-expression init — nothing to convert.
			'let foo = () => { return 1; }; foo = other;',

			// Multiple declarators — can't cleanly replace with a single declaration.
			'const foo = () => { return 1; }, bar = 2',
		],

		invalid: [
			// ── Named bindings → function declaration ────────────────────────────────

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
			// Generators stay generators — only the form changes.
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
			// `this` inside a nested FunctionExpression belongs to that inner function —
			// the outer arrow is safe to promote.
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
			// `let` with no reassignment — treated the same as `const`.
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

			// ── Anonymous function expressions → arrow ────────────────────────────────

			// Assignment.
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
			// Both the init arrow and the reassignment function expression.
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
			// Object property value (not a method shorthand).
			{
				code: 'const obj = { handler: function() { return 1; } }',
				errors: [{ messageId: 'preferArrowFunction' }],
				output: 'const obj = { handler: () => { return 1; } }',
			},
		],
	})
})
