import preferFunctionStyle from './rules/prefer-function-style.js';

export const rules = {
  'prefer-function-style': preferFunctionStyle,
} as const;

const plugin = {
  meta: { name: '@baileys-li/eslint-plugin' },
  rules,
  configs: {} as Record<string, unknown>,
};

plugin.configs['recommended'] = {
  plugins: { '@baileys-li': plugin },
  rules: {
    '@baileys-li/prefer-function-style': 'warn',
  },
};

export default plugin;
