import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: ["main.js", "**/*.js", "**/*.mjs", "node_modules/**", "dist/**", ".obsidian/**", "*.config.js", "*.config.mjs"]
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      }
    },
    plugins: {
      obsidianmd: obsidianmd
    },
    rules: {
      ...obsidianmd.configs.recommended,
      "obsidianmd/ui/sentence-case": ["error", { "allowAutoFix": true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "args": "none" }],
      "@typescript-eslint/ban-ts-comment": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-unused-expressions": ["error", {
        "allowShortCircuit": true,
        "allowTernary": true,
        "allowTaggedTemplates": true
      }]
    }
  }
];
