import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": "error",
      complexity: ["warn", 10],
      "max-depth": ["warn", 3],
      "max-lines-per-function": ["warn", { max: 60, skipComments: true }],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    // Plain Node scripts live outside the TypeScript project, so type-aware
    // rules cannot run against them.
    files: ["scripts/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { project: null, projectService: false },
      globals: {
        Buffer: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "no-console": "off",
      "max-lines-per-function": "off",
      // The smoke run is a flat sequence of assertions, not branching logic.
      complexity: "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  }
);
