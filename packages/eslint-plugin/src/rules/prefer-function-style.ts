import type { Rule } from 'eslint'
import type { FunctionExpression, Identifier, VariableDeclaration } from 'estree'

/**
 * Walks the AST looking for `this`, but does not descend into non-arrow
 * functions or classes, since those rebind `this` for their own scope.
 */
function containsThis(node: unknown): boolean {
	if (!node || typeof node !== 'object') return false
	const n = node as Record<string, unknown>

	if (n['type'] === 'ThisExpression') return true

	// These node types introduce a new `this` binding — stop here.
	if (
		n['type'] === 'FunctionDeclaration' ||
		n['type'] === 'FunctionExpression' ||
		n['type'] === 'ClassDeclaration' ||
		n['type'] === 'ClassExpression'
	) {
		return false
	}

	for (const [key, value] of Object.entries(n)) {
		// `parent` is a back-reference added by ESLint — skip to avoid cycles.
		if (key === 'parent') continue
		if (Array.isArray(value)) {
			if (value.some((item) => containsThis(item))) return true
		} else if (value && typeof value === 'object' && 'type' in (value as object)) {
			if (containsThis(value)) return true
		}
	}

	return false
}

/**
 * Returns the params text including surrounding parens.
 * Handles single-param arrows without parens: `x => {}` → `(x)`.
 */
function extractParamsText(fn: FunctionExpression, sourceCode: Rule.RuleContext['sourceCode']): string {
	if (fn.params.length === 0) return '()'

	const fullSrc = sourceCode.getText()
	const firstParam = fn.params[0] as Rule.Node
	const lastParam = fn.params[fn.params.length - 1] as Rule.Node

	const fnStart = (fn as unknown as Rule.Node).range![0]
	let open = firstParam.range![0] - 1
	// Allow open === fnStart: when the function starts with `(`, fnStart is the
	// paren itself. Using `>` would skip it and misidentify the case as no-parens.
	while (open >= fnStart && fullSrc[open] !== '(') open--

	if (open < fnStart || fullSrc[open] !== '(') {
		// No `(` found within the function's own range — single-param arrow without parens.
		return `(${sourceCode.getText(firstParam)})`
	}

	let close = lastParam.range![1]
	while (close < fullSrc.length && fullSrc[close] !== ')') close++

	return fullSrc.slice(open, close + 1)
}

const rule: Rule.RuleModule = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		schema: [],
		messages: {
			preferFunctionDeclaration:
				'Prefer a function declaration. Use an arrow function only for concise implicit-return expressions.',
			preferArrowFunction: 'Prefer an arrow function for an anonymous function expression.',
		},
		docs: {
			description:
				'Enforce function declarations for named bindings; arrow functions for anonymous function expressions.',
		},
	},

	create(context) {
		const { sourceCode } = context

		/** Converts a FunctionExpression to an arrow function in-place. */
		function reportAsArrow(fn: FunctionExpression): void {
			// Generators cannot be expressed as arrow functions.
			if (fn.generator || containsThis(fn.body)) return

			context.report({
				node: fn as Rule.Node,
				messageId: 'preferArrowFunction',
				fix(fixer) {
					const asyncKw = fn.async ? 'async ' : ''
					const paramsText = extractParamsText(fn, sourceCode)
					const bodyText = sourceCode.getText(fn.body as Rule.Node)
					return fixer.replaceText(fn as Rule.Node, `${asyncKw}${paramsText} => ${bodyText}`)
				},
			})
		}

		return {
			// ── Named bindings: prefer function declaration ─────────────────────────

			VariableDeclaration(varDecl) {
				const { kind } = varDecl

				// `var` is excluded: its function-scoped hoisting diverges from the
				// block-scoped `function` declaration semantics in strict mode (ESM).
				if (kind === 'var' || varDecl.declarations.length !== 1) return

				const [declarator] = varDecl.declarations
				if (declarator.id.type !== 'Identifier' || !declarator.init) return

				if (kind === 'let') {
					const [variable] = sourceCode.getDeclaredVariables(varDecl)
					const isReassigned = variable?.references.some((ref) => ref.isWrite() && !ref.init)

					if (isReassigned) {
						// Can't promote to a function declaration, but a FunctionExpression
						// init can still become an arrow for consistency.
						if (declarator.init.type === 'FunctionExpression') {
							reportAsArrow(declarator.init as FunctionExpression)
						}
						return
					}
				}

				const fn = declarator.init
				const isBlockArrow = fn.type === 'ArrowFunctionExpression' && fn.body.type === 'BlockStatement'

				if (!isBlockArrow && fn.type !== 'FunctionExpression') return
				if (containsThis(fn.body)) return

				context.report({
					node: fn as Rule.Node,
					messageId: 'preferFunctionDeclaration',
					fix(fixer) {
						const name = (declarator.id as Identifier).name
						const asyncKw = fn.async ? 'async ' : ''
						const generatorMark = fn.type === 'FunctionExpression' && fn.generator ? '*' : ''

						// TypeScript-specific nodes are present when @typescript-eslint/parser is used.
						const typeParams =
							'typeParameters' in fn && fn.typeParameters
								? sourceCode.getText(fn.typeParameters as Rule.Node)
								: ''
						const returnType =
							'returnType' in fn && fn.returnType ? sourceCode.getText(fn.returnType as Rule.Node) : ''

						const paramsText = extractParamsText(fn as FunctionExpression, sourceCode)
						const bodyText = sourceCode.getText(fn.body as Rule.Node)

						const fnDecl = `${asyncKw}function${generatorMark} ${name}${typeParams}${paramsText}${returnType} ${bodyText}`

						// `export const foo = …` → `export function foo() {}`
						const parent = varDecl.parent
						if (parent?.type === 'ExportNamedDeclaration') {
							return fixer.replaceText(parent as Rule.Node, `export ${fnDecl}`)
						}

						return fixer.replaceText(varDecl as Rule.Node, fnDecl)
					},
				})
			},

			// ── Anonymous function expressions: prefer arrow ────────────────────────

			FunctionExpression(fn) {
				const parent = (fn as unknown as Rule.Node).parent

				// Method shorthands (`{ foo() {} }`) and class methods use FunctionExpression
				// internally, but replacing them with an arrow would be a syntax error.
				if (parent?.type === 'MethodDefinition') return
				if (parent?.type === 'Property' && (parent as unknown as { method: boolean }).method) return

				// Named `const`/`let` declarations are handled by the VariableDeclaration
				// visitor above (function declaration promotion or reassigned-let arrow).
				if (
					parent?.type === 'VariableDeclarator' &&
					(parent as Rule.Node & { id?: { type: string } }).id?.type === 'Identifier'
				) {
					return
				}

				reportAsArrow(fn)
			},
		}
	},
}

export default rule
