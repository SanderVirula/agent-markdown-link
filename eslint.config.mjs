import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".superpowers/**",
      ".worktrees/**",
      "coverage/**",
      "dist/**",
      "marketplace/**",
      "node_modules/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.base.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
