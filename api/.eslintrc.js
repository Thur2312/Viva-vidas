module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    //'plugin:@rocketseat/eslint-config/node',
     'plugin:@typescript-eslint/recommended',
     'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  // `data/` e o volume do docker-compose (./data/postgres, ./data/redis). Pertence ao root,
  // entao o eslint morre com EACCES ao varrer o diretorio na maquina do dev. Na CI ele nao
  // existe — por isso o job passava lá e quebrava localmente.
  ignorePatterns: ['.eslintrc.js', 'data/**', 'dist/**'],
  overrides: [
    {
      // Em teste, `require()` dinamico e tecnica legitima, nao desleixo: e como se carrega o
      // modulo DEPOIS de `jest.mock`/`jest.resetModules`, que e justamente o ponto de varios
      // destes specs. Trocar por import estatico muda o momento da avaliacao (hoisting) e
      // quebra o mock.
      //
      // Varios destes arquivos JA tentavam suprimir isso com
      // `// eslint-disable-next-line @typescript-eslint/no-var-requires`, mas essa regra foi
      // descontinuada e fundida em `no-require-imports` no typescript-eslint v8 — o comentario
      // virou letra morta e o erro voltou sem ninguem notar.
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'no-unused-vars': 'off',
    'semi': 'off',
    'prettier/prettier': 'off',
    // Logs devem passar pelo PrettyLogger (new Logger(...)) — console.* bypassa
    // formatação/cores/aliases/timestamp. Use o helper logThrottled para logs
    // recorrentes. Exceção autorizada: handlers FATAL em main.ts onde o Logger
    // pode estar destruído (anotar com eslint-disable-next-line).
    'no-console': ['warn'],
  },
};
