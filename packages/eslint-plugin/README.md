# @baileys-li/eslint-plugin

> Opinionated ESLint rules for TypeScript and Node.js code style.

Most function-style rules pick **one** form and enforce it everywhere — `func-style`
makes you choose "always arrows" or "always declarations", `arrow-body-style`
only touches arrows. Real code reads best when the form _follows the situation_:
a named helper is clearest as a `function` declaration, a one-liner as a concise
arrow, a throwaway callback as an arrow. This plugin encodes that judgement in a
single rule so you don't have to wire three core rules together and hope they agree.

## Install

```sh
pnpm add -D @baileys-li/eslint-plugin
```

Requires ESLint 9+ (flat config) and Node 20+.

## Usage

```js
// eslint.config.js
import baileys from '@baileys-li/eslint-plugin'

export default [
	baileys.configs.recommended,
	// …or wire it up by hand:
	{
		plugins: { '@baileys-li': baileys },
		rules: {
			'@baileys-li/readable-function': 'warn',
		},
	},
]
```

## Rule: `readable-function`

One rule, three situational rewrites. Each is autofixable.

| When you write…                                  | …it becomes                 | Why                                        |
| ------------------------------------------------ | --------------------------- | ------------------------------------------ |
| `const f = () => { a(); b() }` _(multi-line)_    | `function f() { a(); b() }` | named, multi-statement → reads as a helper |
| `const f = () => { return x }` _(single return)_ | `const f = () => x`         | a pure expression doesn't need a block     |
| `arr.map(function (x) { … })` _(anonymous)_      | `arr.map((x) => { … })`     | a callback is shorter as an arrow          |

```js
// in
const parseUser = raw => {
	const data = JSON.parse(raw)
	return new User(data)
}
const double = x => {
	return x * 2
}
items.filter(function (item) {
	return item.active
})

// out
function parseUser(raw) {
	const data = JSON.parse(raw)
	return new User(data)
}
const double = x => x * 2
items.filter(item => item.active)
```

### What it deliberately leaves alone

The rule never produces code that changes the meaning of a working program:

- **`this` / `arguments` / `new.target`** — a regular function and an arrow bind
  these differently, so any conversion that would cross the two forms while the
  body uses one of them is skipped. (`obj.arguments` as a property name is fine —
  it isn't the `arguments` object.)
- **Self-referential named function expressions** — `const f = function fact(n) { … fact(n - 1) … }`
  keeps its name; dropping it would break the recursion.
- **Object methods** (`{ handler: function () {} }`) → left to [`object-shorthand`](https://eslint.org/docs/latest/rules/object-shorthand).
- **Class methods** — an arrow there would be a syntax error.
- **Generators** outside a named binding, and **`var`** declarations — semantics
  differ too much to rewrite safely.

## Options

```js
'@baileys-li/readable-function': ['warn', { allowUnsafeFixes: true }]
```

### `allowUnsafeFixes` (default `true`)

Two of the three rewrites are purely syntactic and always safe to apply. The
third — promoting a `const`/`let` binding to a `function` declaration — is the
only one that changes runtime semantics: a function declaration is **hoisted**,
so the binding leaves the temporal dead zone.

In practice this can't break code that already runs (a `const` in its TDZ already
throws on any earlier reference), but the hoisting change is observable, so it's
flagged as the "unsafe" fix:

- `allowUnsafeFixes: true` _(default)_ — apply it with `--fix` like the others.
- `allowUnsafeFixes: false` — still reported, but offered as an editor
  **suggestion** you apply by hand instead of an automatic fix.

| Rewrite                                | Safe?     | `--fix` applies it?          |
| -------------------------------------- | --------- | ---------------------------- |
| arrow `{ return x }` → concise arrow   | ✅        | always                       |
| anonymous `function` → arrow           | ✅        | always                       |
| `const`/`let` → `function` declaration | ⚠️ hoists | only when `allowUnsafeFixes` |

> Note on `new`: converting a `function` to an arrow drops its constructability
> (arrows have no `prototype` and can't be `new`-ed). This plugin treats
> `new someFunction()` as an anti-pattern — use a `class` — and so does not guard
> against it. If your codebase constructs plain functions, don't enable the
> anonymous-function rewrite.

## How it relates to core ESLint rules

`readable-function` is meant to **replace** this trio with one coherent rule:

- `func-style` — picks one form globally; this rule is situational.
- `arrow-body-style` — overlaps with the concise-arrow rewrite.
- `prefer-arrow-callback` — overlaps with the anonymous-callback rewrite.

It **complements** [`object-shorthand`](https://eslint.org/docs/latest/rules/object-shorthand),
which owns the object-method case this rule skips. Enable that one alongside it.

## License

[MIT](./LICENSE) © Arthur Baileys Li
