const vscodeConfig = require('./.vscode/settings.json');

module.exports = {
  language: 'en,es',
  import: ['@cspell/dict-es-es/cspell-ext.json'],
  ignorePaths: [
    'node_modules',
    'public',
    'build',
    '.next',
    'tsconfig.tsbuildinfo',
    'biome.json',
    '*.erd.json',
    'next.config.ts',
    '.gitignore',
    'pnpm-lock.yaml',
    'extensions.json',
    'next.config.ts',
    '*.ts.snap',
    '.github/**',
    'supabase/**',
    '.claudeignore',
  ],
  words: vscodeConfig['cSpell.words'],
};
