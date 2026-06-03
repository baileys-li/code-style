import type { Rule } from 'eslint'
import type {
	ArrowFunctionExpression,
	BlockStatement,
	FunctionExpression,
	Identifier,
	ReturnStatement,
	VariableDeclaration,
} from 'estree'

type AnyFn = FunctionExpression | ArrowFunctionExpression
type WithParent<T> = T & Rule.NodeParentExtension

/**
 * Walks the AST looking for `this`, but does not descend into non-arrow
 * functions or classes, since those rebind `this` for their own scope.
 */
function containsThis(node: unknown): boolean {
	if (!node || typeof node !== 'object') return false
	const n = node as Record<string, unknown>

	if (n['type'] === 'ThisExpression') return true

	if (
		n['type'] === 'FunctionDeclaration' ||
		n['type'] === 'FunctionExpression' ||
		n['type'] === 'ClassDeclaration' ||
		n['type'] === 'ClassExpression'
	) {
		return false
	}

	for (const [key, value] of Object.entries(n)) {
		if (key === 'parent') continue // back-reference added by ESLint — skip to avoid cycles
		if (Array.isArray(value)) {
			if (value.some((item) => containsThis(item))) return true
		} else if (value && typeof value === 'object' && 'type' in (value as object)) {
			if (containsThis(value)) return true
		}
	}

	return false
}

/** Returns the single return argument if the body is exactly `{ return <expr>; }`. */
function singleReturnArgument(body: BlockStatement): ReturnStatement['argument'] | undefined {
	if (body.body.length !== 1) return undefined
	const [stmt] = body.body
	if (stmt.type !== 'ReturnStatement' || stmt.argument == null) return undefined
	return stmt.argument
}

/**
 * Returns the params text including surrounding parens.
 * Handles single-param arrows without parens: `x => {}` → `(x)`.
 */
function extractParamsText(fn: AnyFn, sourceCode: Rule.RuleContext['sourceCode']): string {
	if (fn.params.length === 0) return '()'

	const fullSrc = sourceCode.getText()
	const firstParam = fn.params[0]
	const lastParam = fn.params[fn.params.length - 1]

	const fnStart = fn.range![0]
	let open = firstParam.range![0] - 1
	// Allow open === fnStart: when the function starts with `(`, fnStart IS the
	// paren. Using `>` would skip it and misidentify the case as no-parens.
	while (open >= fnStart && fullSrc[open] !== '(') open--

	if (open < fnStart || fullSrc[open] !== '(') {
		// No `(` within the function's own range — single-param arrow without parens.
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
				'Use a function declaration — named functions are more readable as declarations.',
			preferConciseArrow: 'Use a concise arrow function — the function just returns an expression.',
			preferArrowFunction: 'Use an arrow function — anonymous functions are shorter as arrows.',
		},
		docs: {
			description:
				'Enforce function declarations for named multi-statement functions; concise arrows for single-return expressions; arrow functions for anonymous callbacks.',
		},
	},

	create(context) {
		const { sourceCode } = context

		function reportAsArrow(fn: WithParent<FunctionExpression>): void {
			if (fn.generator || containsThis(fn.body)) return

			context.report({
				node: fn,
				messageId: 'preferArrowFunction',
				fix(fixer) {
					const asyncKw = fn.async ? 'async ' : ''
					const paramsText = extractParamsText(fn, sourceCode)
					const bodyText = sourceCode.getText(fn.body)
					return fixer.replaceText(fn, `${asyncKw}${paramsText} => ${bodyText}`)
				},
			})
		}

		return {
			VariableDeclaration(varDecl: WithParent<VariableDeclaration>) {
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
							reportAsArrow(declarator.init as WithParent<FunctionExpression>)
						}
						return
					}
				}

				const fn = declarator.init
				const isBlockArrow = fn.type === 'ArrowFunctionExpression' && fn.body.type === 'BlockStatement'

				if (!isBlockArrow && fn.type !== 'FunctionExpression') return
				if (containsThis(fn.body)) return

				const body = fn.body as BlockStatement
				const returnArg = singleReturnArgument(body)

				if (returnArg != null && (fn.type === 'ArrowFunctionExpression' || !fn.generator)) {
					// Body is exactly `{ return <expr>; }` — prefer concise arrow.
					context.report({
						node: fn,
						messageId: 'preferConciseArrow',
						fix(fixer) {
							const asyncKw = fn.async ? 'async ' : ''
							const typeParams =
								'typeParameters' in fn && fn.typeParameters
									? sourceCode.getText(fn.typeParameters as Rule.Node)
									: ''
							const paramsText = extractParamsText(fn as AnyFn, sourceCode)
							const returnType =
								'returnType' in fn && fn.returnType
									? sourceCode.getText(fn.returnType as Rule.Node)
									: ''
							const argText = sourceCode.getText(returnArg)
							// Wrap ObjectExpression to prevent `{` being parsed as a block.
							const exprText = returnArg.type === 'ObjectExpression' ? `(${argText})` : argText
							return fixer.replaceText(fn, `${asyncKw}${typeParams}${paramsText}${returnType} => ${exprText}`)
						},
					})
					return
				}

				// Multi-statement body (or generator) — prefer function declaration.
				context.report({
					node: fn,
					messageId: 'preferFunctionDeclaration',
					fix(fixer) {
						const name = (declarator.id as Identifier).name
						const asyncKw = fn.async ? 'async ' : ''
						const generatorMark = fn.type === 'FunctionExpression' && fn.generator ? '*' : ''
						const typeParams =
							'typeParameters' in fn && fn.typeParameters
								? sourceCode.getText(fn.typeParameters as Rule.Node)
								: ''
						const returnType =
							'returnType' in fn && fn.returnType
								? sourceCode.getText(fn.returnType as Rule.Node)
								: ''
						const paramsText = extractParamsText(fn as AnyFn, sourceCode)
						const bodyText = sourceCode.getText(fn.body)
						const fnDecl = `${asyncKw}function${generatorMark} ${name}${typeParams}${paramsText}${returnType} ${bodyText}`

						// `export const foo = …` → `export function foo() {}`
						if (varDecl.parent.type === 'ExportNamedDeclaration') {
							return fixer.replaceText(varDecl.parent, `export ${fnDecl}`)
						}

						return fixer.replaceText(varDecl, fnDecl)
					},
				})
			},

			FunctionExpression(fn: WithParent<FunctionExpression>) {
				const { parent } = fn

				// Class methods — replacing with an arrow would be a syntax error.
				if (parent.type === 'MethodDefinition') return

				// Object properties are handled by the `object-shorthand` rule:
				// `{ handler: function() {} }` → `{ handler() {} }` or `{ handler: () => expr }`.
				if (parent.type === 'Property') return

				// Named `const`/`let` declarations are handled by the VariableDeclaration
				// visitor above (function declaration promotion or reassigned-let arrow).
				if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return

				reportAsArrow(fn)
			},
		}
	},
}

export default rule
