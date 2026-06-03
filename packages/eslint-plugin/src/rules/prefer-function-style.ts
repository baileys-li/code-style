import type { Rule } from 'eslint';
import type {
  ArrowFunctionExpression,
  FunctionExpression,
  Identifier,
  VariableDeclaration,
} from 'estree';

type FnNode = ArrowFunctionExpression | FunctionExpression;

/**
 * Walks the AST looking for `this`, but does not descend into non-arrow
 * functions or classes, since those rebind `this` for their own scope.
 */
function containsThis(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;

  if (n['type'] === 'ThisExpression') return true;

  // These node types introduce a new `this` binding — stop here.
  if (
    n['type'] === 'FunctionDeclaration' ||
    n['type'] === 'FunctionExpression' ||
    n['type'] === 'ClassDeclaration' ||
    n['type'] === 'ClassExpression'
  ) {
    return false;
  }

  for (const [key, value] of Object.entries(n)) {
    // `parent` is a back-reference added by ESLint — skip to avoid cycles.
    if (key === 'parent') continue;
    if (Array.isArray(value)) {
      if (value.some((item) => containsThis(item))) return true;
    } else if (value && typeof value === 'object' && 'type' in (value as object)) {
      if (containsThis(value)) return true;
    }
  }

  return false;
}

/**
 * Returns the params text including surrounding parens.
 * Handles single-param arrows without parens: `x => {}` → `(x)`.
 */
function extractParamsText(fn: FnNode, sourceCode: Rule.RuleContext['sourceCode']): string {
  if (fn.params.length === 0) return '()';

  const fullSrc = sourceCode.getText();
  const firstParam = fn.params[0] as Rule.Node;
  const lastParam = fn.params[fn.params.length - 1] as Rule.Node;

  // ArrowFunctionExpression with a single bare param (`x => {}`) starts at
  // the param itself, so fnStart === firstParam start — there's no `(`.
  const fnStart = (fn as unknown as Rule.Node).range![0];
  let open = firstParam.range![0] - 1;
  // Allow open === fnStart: when the function starts with `(`, fnStart is the
  // paren itself. Using `>` would skip it and misidentify the case as no-parens.
  while (open >= fnStart && fullSrc[open] !== '(') open--;

  if (open < fnStart || fullSrc[open] !== '(') {
    // No `(` found within the function's own range — single-param arrow without parens.
    return `(${sourceCode.getText(firstParam)})`;
  }

  let close = lastParam.range![1];
  while (close < fullSrc.length && fullSrc[close] !== ')') close++;

  return fullSrc.slice(open, close + 1);
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: {
      preferFunctionDeclaration:
        'Prefer a function declaration. Use an arrow function only for concise implicit-return expressions.',
    },
    docs: {
      description:
        'Enforce function declarations for block-body functions; allow arrows only for implicit-return expressions.',
    },
  },

  create(context) {
    const { sourceCode } = context;

    return {
      VariableDeclaration(varDecl: VariableDeclaration & Rule.NodeParentExtension) {
        // Only target `const` — `let`/`var` imply intentional reassignability.
        if (varDecl.kind !== 'const' || varDecl.declarations.length !== 1) return;

        const [declarator] = varDecl.declarations;
        if (declarator.id.type !== 'Identifier' || !declarator.init) return;

        const fn = declarator.init;
        const isBlockArrow =
          fn.type === 'ArrowFunctionExpression' && fn.body.type === 'BlockStatement';

        if (!isBlockArrow && fn.type !== 'FunctionExpression') return;

        // Changing arrow ↔ declaration affects `this` binding — skip.
        if (containsThis(fn.body)) return;

        context.report({
          node: fn as Rule.Node,
          messageId: 'preferFunctionDeclaration',
          fix(fixer) {
            const fnNode = fn as FnNode;
            const name = (declarator.id as Identifier).name;
            const asyncKw = fnNode.async ? 'async ' : '';
            const generatorMark =
              fnNode.type === 'FunctionExpression' && fnNode.generator ? '*' : '';

            // TypeScript-specific nodes are present when @typescript-eslint/parser is used.
            const typeParams =
              'typeParameters' in fnNode && fnNode.typeParameters
                ? sourceCode.getText(fnNode.typeParameters as Rule.Node)
                : '';
            const returnType =
              'returnType' in fnNode && fnNode.returnType
                ? sourceCode.getText(fnNode.returnType as Rule.Node)
                : '';

            const paramsText = extractParamsText(fnNode, sourceCode);
            const bodyText = sourceCode.getText(fnNode.body as Rule.Node);

            const fnDecl = `${asyncKw}function${generatorMark} ${name}${typeParams}${paramsText}${returnType} ${bodyText}`;

            // `export const foo = …` → `export function foo() {}`
            const parent = varDecl.parent;
            if (parent?.type === 'ExportNamedDeclaration') {
              return fixer.replaceText(parent as Rule.Node, `export ${fnDecl}`);
            }

            return fixer.replaceText(varDecl as Rule.Node, fnDecl);
          },
        });
      },
    };
  },
};

export default rule;
