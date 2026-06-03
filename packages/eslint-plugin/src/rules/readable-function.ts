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

interface Options {
	/** See the schema description. Defaults to `true`. */
	allowUnsafeFixes?: boolean
}

// ── `this` / `arguments` / `new.target` detection ──────────────────────────

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
		// `obj.arguments` and `{ arguments: … }` are plain names, not the binding —
		// only descend into a member/property key when it is computed.
		case 'MemberExpression':
			return usesFunctionBinding(node.object) || (node.computed && usesFunctionBinding(node.property as Node))
		case 'Property':
			return (node.computed && usesFunctionBinding(node.key)) || usesFunctionBinding(node.value)
		default:
			return someChildUsesFunctionBinding(node)
	}
}

/** Recurse into every child node, skipping ESLint's circular `parent` link. */
function someChildUsesFunctionBinding(node: Node): boolean {
	for (const key in node) {
		if (key === 'parent') continue
		const value = node[key as keyof Node]
		const found = Array.isArray(value) ? value.some(hasFunctionBinding) : hasFunctionBinding(value)
		if (found) return true
	}
	return false
}

/** A named function expression whose body refers to its own name can't be renamed away. */
function isSelfReferenced(fn: AnyFunction, sourceCode: SourceCode): boolean {
	if (fn.type !== 'FunctionExpression' || !fn.id) return false
	const nameVar = sourceCode.getDeclaredVariables(fn).find(variable => variable.name === fn.id!.name)
	return (nameVar?.references.length ?? 0) > 0
}

// ── Source-text reconstruction ─────────────────────────────────────────────

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

/** Text of an optional TS annotation (type parameters / return type), or ''. */
function annotationText(fn: AnyFunction, key: keyof TSFunctionAnnotations, sourceCode: SourceCode): string {
	const node = (fn as AnyFunction & TSFunctionAnnotations)[key]
	return node ? sourceCode.getText(node) : ''
}

/** `<T>(a: T): T` — generics, params and return type in source order, no name. */
function signatureText(fn: AnyFunction, sourceCode: SourceCode): string {
	return `${annotationText(fn, 'typeParameters', sourceCode)}${paramListText(fn, sourceCode)}${annotationText(fn, 'returnType', sourceCode)}`
}

// ── Decision ───────────────────────────────────────────────────────────────

type Rewrite = { kind: 'conciseArrow'; returnArg: Expression } | { kind: 'functionDeclaration' }

/**
 * Which rewrite a block-bodied named binding should get, or undefined to leave
 * it as is. A single-return body reads best as a concise arrow; anything longer
 * (or a generator) as a named declaration. Either way a conversion that crosses
 * the function/arrow forms is skipped when the body uses `this`/`arguments`,
 * since the two forms bind them differently.
 */
function chooseRewrite(fn: AnyFunction, body: BlockStatement): Rewrite | undefined {
	const isRegularFunction = fn.type === 'FunctionExpression'
	const usesBinding = usesFunctionBinding(body)
	const returnArg = extractSingleReturnArgument(body)
	const isGenerator = isRegularFunction && fn.generator

	const canBecomeArrow = !isRegularFunction || !usesBinding
	if (returnArg && !isGenerator && canBecomeArrow) return { kind: 'conciseArrow', returnArg }

	const canBecomeDeclaration = isRegularFunction || !usesBinding
	if (canBecomeDeclaration) return { kind: 'functionDeclaration' }

	return undefined
}

/**
 * The block-bodied function a single named `const`/`let` binds — or undefined
 * for `var`, multi-declarator, destructured, non-function, or concise-arrow
 * declarations, none of which this rule rewrites.
 *
 * `var` is excluded because its function-scoped hoisting diverges from the
 * block-scoped `function` declaration semantics in strict mode (ESM).
 */
function namedBlockBinding(
	varDecl: VariableDeclaration,
): { declarator: VariableDeclarator; fn: AnyFunction; body: BlockStatement } | undefined {
	if (varDecl.kind === 'var' || varDecl.declarations.length !== 1) return undefined

	const [declarator] = varDecl.declarations
	if (declarator.id.type !== 'Identifier' || !declarator.init) return undefined

	const fn = declarator.init
	const isBlockBodied = fn.type === 'FunctionExpression' || (fn.type === 'ArrowFunctionExpression' && fn.body.type === 'BlockStatement')
	if (!isBlockBodied) return undefined

	return { declarator, fn, body: fn.body as BlockStatement }
}

/** Whether a `let` binding is written anywhere other than its initializer. */
function isReassigned(varDecl: VariableDeclaration, sourceCode: SourceCode): boolean {
	const [variable] = sourceCode.getDeclaredVariables(varDecl)
	return variable?.references.some(ref => ref.isWrite() && !ref.init) ?? false
}

/** FunctionExpression positions owned by another visitor or rule, not by the arrow rewrite. */
function isHandledElsewhere(parent: Node): boolean {
	return (
		parent.type === 'MethodDefinition' || // class method — an arrow would be a syntax error
		parent.type === 'Property' || // object method — left to `object-shorthand`
		(parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') // named binding — see VariableDeclaration
	)
}

// ── Reports ────────────────────────────────────────────────────────────────

/** `arr.map(function (x) { … })` → `arr.map((x) => { … })` */
function reportArrowFunction(context: Rule.RuleContext, fn: FunctionExpression): void {
	const { sourceCode } = context
	if (fn.generator || usesFunctionBinding(fn.body) || isSelfReferenced(fn, sourceCode)) return

	context.report({
		node: fn,
		messageId: 'preferArrowFunction',
		fix: fixer => fixer.replaceText(fn, `${fn.async ? 'async ' : ''}${signatureText(fn, sourceCode)} => ${sourceCode.getText(fn.body)}`),
	})
}

/** `const foo = () => { return x; }` → `const foo = () => x` */
function reportConciseArrow(context: Rule.RuleContext, fn: AnyFunction, returnArg: Expression): void {
	const { sourceCode } = context
	context.report({
		node: fn,
		messageId: 'preferConciseArrow',
		fix(fixer) {
			const head = `${fn.async ? 'async ' : ''}${signatureText(fn, sourceCode)}`
			const argText = sourceCode.getText(returnArg)
			// Parenthesise an object literal so `{` is not parsed as a block.
			const exprText = returnArg.type === 'ObjectExpression' ? `(${argText})` : argText
			return fixer.replaceText(fn, `${head} => ${exprText}`)
		},
	})
}

/**
 * `const foo = () => { a(); b(); }` → `function foo() { a(); b(); }`
 *
 * This is the one transform that changes runtime semantics: a function
 * declaration is hoisted, so the binding leaves the temporal dead zone. It
 * cannot break code that already runs (a `const` in its TDZ already throws on
 * any earlier reference), but the hoisting change is observable — so it is an
 * autofix only while `allowUnsafeFixes` is on, and a manual suggestion otherwise.
 */
function reportFunctionDeclaration(
	context: Rule.RuleContext,
	varDecl: WithParent<VariableDeclaration>,
	declarator: VariableDeclarator,
	fn: AnyFunction,
): void {
	const { sourceCode } = context
	const { allowUnsafeFixes = true }: Options = context.options[0] ?? {}

	const fix: Rule.ReportFixer = fixer => {
		const name = (declarator.id as Identifier).name
		const star = fn.type === 'FunctionExpression' && fn.generator ? '*' : ''
		const declaration = `${fn.async ? 'async ' : ''}function${star} ${name}${signatureText(fn, sourceCode)} ${sourceCode.getText(fn.body)}`

		// Replace the whole `export const …` so the `export` keyword survives.
		if (varDecl.parent.type === 'ExportNamedDeclaration') {
			return fixer.replaceText(varDecl.parent, `export ${declaration}`)
		}
		return fixer.replaceText(varDecl, declaration)
	}

	context.report({
		node: fn,
		messageId: 'preferFunctionDeclaration',
		...(allowUnsafeFixes ? { fix } : { suggest: [{ messageId: 'convertToFunctionDeclaration', fix }] }),
	})
}

// ── Rule ───────────────────────────────────────────────────────────────────

const meta: Rule.RuleModule['meta'] = {
	type: 'suggestion',
	fixable: 'code',
	hasSuggestions: true,
	schema: [
		{
			type: 'object',
			properties: {
				allowUnsafeFixes: {
					type: 'boolean',
					description:
						'Auto-apply the `const`/`let` → function-declaration promotion. It hoists the binding out of the TDZ, so it is the one transform that changes runtime semantics. When `false`, the rule still reports it but offers it as a manual suggestion instead of an autofix. Defaults to `true`.',
				},
			},
			additionalProperties: false,
		},
	],
	messages: {
		preferFunctionDeclaration: 'Use a function declaration — named functions are more readable as declarations.',
		preferConciseArrow: 'Use a concise arrow function — the function just returns an expression.',
		preferArrowFunction: 'Use an arrow function — anonymous functions are shorter as arrows.',
		convertToFunctionDeclaration: 'Convert to a function declaration (hoists the binding).',
	},
	docs: {
		description:
			'Enforce function declarations for named multi-statement functions; concise arrows for single-return expressions; arrow functions for anonymous callbacks.',
	},
}

const rule: Rule.RuleModule = {
	meta,
	create(context) {
		const { sourceCode } = context

		return {
			VariableDeclaration(varDecl) {
				const binding = namedBlockBinding(varDecl)
				if (!binding) return
				const { declarator, fn, body } = binding

				// A reassigned `let` can't become a declaration, but its
				// function-expression init can still become an arrow.
				if (varDecl.kind === 'let' && isReassigned(varDecl, sourceCode)) {
					if (fn.type === 'FunctionExpression') reportArrowFunction(context, fn)
					return
				}
				if (isSelfReferenced(fn, sourceCode)) return

				const rewrite = chooseRewrite(fn, body)
				if (rewrite?.kind === 'conciseArrow') reportConciseArrow(context, fn, rewrite.returnArg)
				else if (rewrite?.kind === 'functionDeclaration') reportFunctionDeclaration(context, varDecl, declarator, fn)
			},

			FunctionExpression(fn) {
				if (!isHandledElsewhere(fn.parent)) reportArrowFunction(context, fn)
			},
		}
	},
}

export default rule
