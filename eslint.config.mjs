import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";

import { includeIgnoreFile } from "@eslint/compat";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

export default [ includeIgnoreFile(gitignorePath), {
    files: ["**/*.js", "**/*.mjs"],
    ...js.configs.recommended,
}, {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
        globals: {
            ...globals.browser,
            browser: "readonly",
            chrome: "readonly",
            vAPI: "readonly",
        },
        sourceType: "module",
    },
    rules: {
        eqeqeq: ["warn", "always"],
        indent: ["error", 4, {
            ignoredNodes: [
                "Program > BlockStatement",
                "Program > ExpressionStatement > CallExpression > ArrowFunctionExpression > BlockStatement",
                "Program > ExpressionStatement > CallExpression > FunctionExpression > BlockStatement",
                "Program > IfStatement > BlockStatement",
                "Program > VariableDeclaration > VariableDeclarator > CallExpression > ArrowFunctionExpression > BlockStatement",
                "CallExpression > MemberExpression",
                "ArrayExpression > *",
                "ObjectExpression > *",
            ],
        }],
        "no-control-regex": "off",
        "no-empty": "off",
        "sort-imports": "error",
        "strict": "error",
    },
}, {
    files: ["**/*.json"],
    ignores: ["package-lock.json"],
    language: "json/json",
    ...json.configs.recommended,
} ];
