import type { ESLint, Linter } from 'eslint'

import readableFunctionStyle from './rules/readable-function.js'

const rules = {
	'readable-function': readableFunctionStyle,
} as const

const plugin: ESLint.Plugin = {
	meta: { name: '@baileys-li/eslint-plugin' },
	rules,
}

const recommended: Linter.Config = {
	plugins: { '@baileys-li': plugin },
	rules: {
		'@baileys-li/readable-function': 'warn',
	},
}

plugin.configs = { recommended }

export { rules, recommended }
export default plugin
