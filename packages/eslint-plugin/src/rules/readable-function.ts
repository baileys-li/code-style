import type { AST, Rule, SourceCode } from 'eslint'
import type {
	ArrowFunctionExpression,
	BlockStatement,
	Expression,
	FunctionExpression,
	Identifier,
	Node,
	VariableDeclaration,
	VariableDeclarator,
} from 'estree'

type AnyFunction = FunctionExpression | ArrowFunctionExpression
type WithParent<T> = T & Rule.NodeParentExtension

/**
 * TypeScript-only members the `@typescript-eslint` parser hangs off function
 * nodes. estree has no concept of them, so we describe just what we read here.
 * They are typed as `Node` purely so `sourceCode.getText` accepts them — only
 * their source range is ever used.
 */
interface TSFunctionAnnotations {
	typeParameters?: Node
	returnType?: Node
}

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && 'type' in value
const hasFunctionBinding = (value: unknown) => isNode(value) && usesFunctionBinding(value)

/**
 * True when the subtree relies on a binding a regular function provides but an
 * arrow does not: `this`, `arguments`, or `new.target`. Swapping a function for
 * an arrow (or vice-versa) would silently change what these refer to, so any
 * such conversion must be skipped.
 *
 * The walk stops at nested non-arrow functions and classes — they introduce
 * their own bindings — but descends into arrows, which inherit the outer ones.
 */
function usesFunctionBinding(node: Node): boolean {
	switch (node.type) {
		case 'ThisExpression':
			return true
		case 'Identifier':
			return node.name === 'arguments'
		case 'MetaProperty':
			return node.meta.name === 'new' // `new.target`, not `import.meta`
		case 'FunctionDeclaration':
		case 'FunctionExpression':
		case 'ClassDeclaration':
		case 'ClassExpression':
			return false
		// Only recurse into a member's `property` when it is computed, so that
		// `obj.arguments` (a plain property name) is not mistaken for the object.
		case 'MemberExpression':
			return usesFunctionBinding(node.object) || (node.computed && usesFunctionBinding(node.property as Node))
		case 'Property':
			return (node.computed && usesFunctionBinding(node.key)) || usesFunctionBinding(node.value)
	}

	for (const key in node) {
		// `parent` is a back-reference ESLint adds; following it would loop.
		if (key === 'parent') continue
		const value = node[key as keyof Node]

		if (Array.isArray(value)) {
			if (value.some(hasFunctionBinding)) return true
		} else if (hasFunctionBinding(value)) return true
	}
	return false
}

/** The returned expression when `body` is exactly `{ return <expr>; }`. */
function extractSingleReturnArgument(body: BlockStatement): Expression | undefined {
	if (body.body.length !== 1) return undefined
	const [statement] = body.body
	if (statement.type !== 'ReturnStatement' || !statement.argument) return undefined
	return statement.argument
}

const isPunctuator = (value: string) => (token: AST.Token) => token.type === 'Punctuator' && token.value === value

/** Source text of the parameter list, always parenthesised. */
function paramListText(fn: AnyFunction, sourceCode: SourceCode): string {
	const [firstParam] = fn.params
	const openParen = firstParam
		? sourceCode.getTokenBefore(firstParam, isPunctuator('('))
		: sourceCode.getTokenBefore(fn.body, isPunctuator('('))

	// A single arrow param may have no parens (`x => …`). When the nearest `(`
	// lies outside this function it belongs to surrounding code, so add parens.
	if (!openParen || openParen.range[0] < fn.range![0]) {
		return `(${sourceCode.getText(firstParam)})`
	}

	const lastParam = fn.params.at(-1)
	const closeParen = lastParam
		? sourceCode.getTokenAfter(lastParam, isPunctuator(')'))
		: sourceCode.getTokenAfter(openParen, isPunctuator(')'))

	return sourceCode.getText().slice(openParen.range[0], closeParen!.range[1])
}

const meta: Rule.RuleModule['meta'] = {
	type: 'suggestion',
	fixable: 'code',
	schema: [],
	messages: {
		preferFunctionDeclaration: 'Use a function declaration — named functions are more readable as declarations.',
		preferConciseArrow: 'Use a concise arrow function — the function just returns an expression.',
		preferArrowFunction: 'Use an arrow function — anonymous functions are shorter as arrows.',
	},
	docs: {
		description:
			'Enforce function declarations for named multi-statement functions; concise arrows for single-return expressions; arrow functions for anonymous callbacks.',
	},
}

/** A named function expression whose body refers to its own name can't be renamed away. */
const isSelfReferenced = (fn: AnyFunction, sourceCode: SourceCode): boolean => {
	if (fn.type !== 'FunctionExpression' || !fn.id) return false
	const name = fn.id.name
	const nameVar = sourceCode.getDeclaredVariables(fn).find(variable => variable.name === name)
	if (!nameVar) return false

	return nameVar.references.length > 0
}

function createReporters(context: Rule.RuleContext) {
	const { sourceCode } = context

	/** Text of an optional TS annotation (type parameters / return type), or ''. */
	function getAnnotationText(fn: AnyFunction, key: keyof TSFunctionAnnotations) {
		const node = (fn as AnyFunction & TSFunctionAnnotations)[key]
		return node ? sourceCode.getText(node) : ''
	}

	return {
		/** `arr.map(function (x) { … })` → `arr.map((x) => { … })` */
		asArrow(fn: FunctionExpression): void {
			if (fn.generator || usesFunctionBinding(fn.body) || isSelfReferenced(fn, sourceCode)) return

			context.report({
				node: fn,
				messageId: 'preferArrowFunction',
				fix: fixer =>
					fixer.replaceText(fn, `${fn.async ? 'async ' : ''}${paramListText(fn, sourceCode)} => ${sourceCode.getText(fn.body)}`),
			})
		},

		/** `const foo = () => { return x; }` → `const foo = () => x` */
		conciseArrow(fn: AnyFunction, returnArg: Expression): void {
			context.report({
				node: fn,
				messageId: 'preferConciseArrow',
				fix(fixer) {
					const head = `${fn.async ? 'async ' : ''}${getAnnotationText(fn, 'typeParameters')}${paramListText(fn, sourceCode)}${getAnnotationText(fn, 'returnType')}`
					const argText = sourceCode.getText(returnArg)
					// Parenthesise an object literal so `{` is not parsed as a block.
					const exprText = returnArg.type === 'ObjectExpression' ? `(${argText})` : argText
					return fixer.replaceText(fn, `${head} => ${exprText}`)
				},
			})
		},

		/** `const foo = () => { a(); b(); }` → `function foo() { a(); b(); }` */
		functionDeclaration(varDecl: WithParent<VariableDeclaration>, declarator: VariableDeclarator, fn: AnyFunction): void {
			context.report({
				node: fn,
				messageId: 'preferFunctionDeclaration',
				fix(fixer) {
					const name = (declarator.id as Identifier).name
					const star = fn.type === 'FunctionExpression' && fn.generator ? '*' : ''
					const declaration = `${fn.async ? 'async ' : ''}function${star} ${name}${getAnnotationText(fn, 'typeParameters')}${paramListText(fn, sourceCode)}${getAnnotationText(fn, 'returnType')} ${sourceCode.getText(fn.body)}`

					// Replace the whole `export const …` so the `export` keyword survives.
					if (varDecl.parent.type === 'ExportNamedDeclaration') {
						return fixer.replaceText(varDecl.parent, `export ${declaration}`)
					}
					return fixer.replaceText(varDecl, declaration)
				},
			})
		},
	}
}

const rule: Rule.RuleModule = {
	meta,
	create(context) {
		const { sourceCode } = context
		const report = createReporters(context)

		return {
			VariableDeclaration(varDecl) {
				// `var` is excluded: its function-scoped hoisting diverges from the
				// block-scoped `function` declaration semantics in strict mode (ESM).
				if (varDecl.kind === 'var' || varDecl.declarations.length !== 1) return

				const [declarator] = varDecl.declarations
				if (declarator.id.type !== 'Identifier' || !declarator.init) return
				const init = declarator.init

				// A reassigned `let` can't become a function declaration, but a
				// function-expression initializer can still become an arrow.
				if (varDecl.kind === 'let' && isReassigned(sourceCode, varDecl)) {
					if (init.type === 'FunctionExpression') report.asArrow(init)
					return
				}

				const isBlockBodied =
					init.type === 'FunctionExpression' || (init.type === 'ArrowFunctionExpression' && init.body.type === 'BlockStatement')
				if (!isBlockBodied) return

				const fn = init
				const body = fn.body as BlockStatement
				if (isSelfReferenced(fn, sourceCode)) return

				const returnArg = extractSingleReturnArgument(body)
				const isGenerator = fn.type === 'FunctionExpression' && fn.generator
				const isFunctionExpression = fn.type === 'FunctionExpression'

				if (returnArg && !isGenerator) {
					// Target is an arrow (concise form). Binding changes only when source is a regular
					// function — arrow→arrow keeps the same lexical this/arguments.
					if (!isFunctionExpression || !usesFunctionBinding(body)) {
						report.conciseArrow(fn, returnArg)
					} else {
						// FunctionExpression uses this/arguments: can't become an arrow, but a function
						// declaration preserves the exact same binding.
						report.functionDeclaration(varDecl, declarator, fn)
					}
				} else if (isFunctionExpression || !usesFunctionBinding(body)) {
					// Target is a function declaration. Binding changes only when source is an arrow.
					// FunctionExpression → function declaration is always safe.
					report.functionDeclaration(varDecl, declarator, fn)
				}
				// Arrow with this/arguments in multi-statement body: converting to a function
				// declaration would change the binding — nothing to do.
			},

			FunctionExpression(fn) {
				const { parent } = fn

				// Class methods — an arrow here would be a syntax error.
				if (parent.type === 'MethodDefinition') return
				// Object methods — left to the `object-shorthand` rule.
				if (parent.type === 'Property') return
				// Named `const`/`let` bindings — handled by VariableDeclaration above.
				if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return

				report.asArrow(fn)
			},
		}
	},
}

/** Whether a `let` binding is written anywhere other than its initializer. */
function isReassigned(sourceCode: SourceCode, varDecl: VariableDeclaration): boolean {
	const [variable] = sourceCode.getDeclaredVariables(varDecl)
	return variable?.references.some(ref => ref.isWrite() && !ref.init) ?? false
}

export default rule
