import type { ESLint, Linter } from 'eslint'

import preferFunctionStyle from './rules/prefer-function-style.js'

const rules = {
	'prefer-function-style': preferFunctionStyle,
} as const

const plugin: ESLint.Plugin = {
	meta: { name: '@baileys-li/eslint-plugin' },
	rules,
}

const recommended: Linter.Config = {
	plugins: { '@baileys-li': plugin },
	rules: {
		'@baileys-li/prefer-function-style': 'warn',
	},
}

plugin.configs = { recommended }

export { rules, recommended }
export default plugin
