# Repository Guidelines

## Project Structure & Module Organization

This is a cinematic Moonlight Box homepage built with TypeScript, Three.js, and Vite. `index.html` provides the page shell; `src/main.ts` coordinates startup and interactions. Scene geometry, materials, terrain, lighting, and chest animation live in `src/scene/`. Other `src/` modules handle responsive layouts, inscriptions, transitions, entry icons, and static fallback HTML. Keep shared copy and navigation settings in `src/config.ts`.

Store static images and textures in `public/assets/`; bundled artwork lives in `src/assets/`. Tests belong in `tests/`, and browser verification and asset utilities in `scripts/`. Generated `dist/`, `output/`, and `.playwright-cli/` directories are ignored.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from the lockfile.
- `npm run dev`: start Vite on localhost.
- `npm run build`: run TypeScript checking, then produce `dist/`.
- `npm run preview`: serve the production build locally.
- `npm test`: run all `tests/*.test.ts` files with Node's built-in runner and experimental TypeScript stripping. Use a Node version supporting this flag.
- `git diff --check`: check patches for whitespace errors.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, semicolons, and double-quoted strings, following surrounding code. Name files in kebab-case, functions and variables in camelCase, classes and types in PascalCase, and constants in UPPER_SNAKE_CASE. No dedicated formatter or linter is configured.

Add explanatory Chinese comments for new code; preserve existing comments unless the implementation invalidates them. Reuse existing animation loops, reduced-motion handling, fallback paths, and resource disposal.

## Testing Guidelines

Use `node:test` and `node:assert/strict`. Name tests `tests/<feature>.test.ts`, with descriptive behavior-focused cases. Add regression tests for bugs and tests for new behavior. No numeric coverage threshold is configured.

Run tests and the build before review. For visual changes, inspect actual browser screenshots at desktop, mobile, and short-screen sizes. Check reduced-motion, WebGL fallback, and JavaScript-disabled behavior when affected. Browser helpers in `scripts/verify-*.cjs` generally run through Playwright tooling; inspect their invocation comments first.

## Commit & Pull Request Guidelines

Recent commits use concise Chinese action summaries, such as `右侧草缺失修复`. Follow this style and keep each commit focused.

Pull requests should explain the problem, resulting behavior, validation commands, and related issues when applicable. Include before/after screenshots and viewport dimensions for visual changes. Preserve established composition and interactions outside the requested scope, and exclude generated captures and build output.
