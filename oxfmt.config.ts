import { defineConfig } from 'oxfmt'

export default defineConfig({
	arrowParens: 'avoid',
	endOfLine: 'lf',
	ignorePatterns: ['dist', 'node_modules'],
	printWidth: 140,
	semi: false,
	singleQuote: true,
	sortImports: true,
	sortPackageJson: true,
	tabWidth: 2,
	trailingComma: 'all',
	useTabs: true,
})
