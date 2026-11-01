# Repository Guidelines

## Project Structure & Module Organization

This is a cinematic Moonlight Box homepage built with TypeScript, Three.js, and Vite. `index.html` provides the page shell; `src/main.ts` coordinates startup and interactions. Scene geometry, materials, terrain, lighting, and chest animation live in `src/scene/`. Other `src/` modules handle responsive layouts, inscriptions, transitions, entry icons, and static fallback HTML. Keep shared copy and navigation settings in `src/config.ts`.

Store static images and textures in `public/assets/`; bundled artwork lives in `src/assets/`. Tests belong in `tests/`, and browser verification and asset utilities in `scripts/`. Generated `dist/`, `output/`, and `.playwright-cli/` directories are ignored.

Archive offline entry and cursor originals in `assets/source/entry-artwork/`; these files are authoring inputs, not runtime URLs. `scripts/prepare-entry-artwork.py` resolves this directory relative to the script and writes runtime textures and cursors to `public/assets/`. Entry first-frame export and the five static-scene captures use `output/playwright/` as temporary storage; commit the resulting runtime assets in `public/assets/`, not temporary captures, logs, or `dist/`.

When moving or replacing artwork, update its generator inputs, source records, and documentation links together. Preserve existing runtime filenames and URLs unless a runtime change is explicitly requested. For a path-only move, compare original SHA256 values and regenerated image dimensions and pixels. Check for stale paths, run tests and build, and inspect desktop/mobile/short-screen rendering, both entry icons, three cursor states, and affected fallback paths. See README for the authoring commands; do not duplicate the workflow here.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from the lockfile.
- `npm run dev`: start Vite on localhost.
- `npm run build`: run TypeScript checking, then produce `dist/`.
- `npm run preview`: serve the production build locally.
- Use Node.js 22.18+ and npm for the complete workflow; Node 20 can satisfy Vite's engine range but cannot run this project's TypeScript test command. Check the actual `node --version` and executable before validation.
- `npm test`: run all `tests/*.test.ts` files with Node's built-in runner and `--experimental-strip-types`.
- `git diff --check`: check patches for whitespace errors.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, semicolons, and double-quoted strings, following surrounding code. Name files in kebab-case, functions and variables in camelCase, classes and types in PascalCase, and constants in UPPER_SNAKE_CASE. No dedicated formatter or linter is configured.

Add explanatory Chinese comments for new code; preserve existing comments unless the implementation invalidates them. Reuse existing animation loops, reduced-motion handling, fallback paths, and resource disposal.

## Testing Guidelines

Use `node:test` and `node:assert/strict`. Name tests `tests/<feature>.test.ts`, with descriptive behavior-focused cases. Add regression tests for bugs and tests for new behavior. No numeric coverage threshold is configured.

Run tests and the build before review. For visual changes, inspect actual browser screenshots at desktop, mobile, and short-screen sizes. Check reduced-motion, WebGL fallback, and JavaScript-disabled behavior when affected. Browser helpers in `scripts/verify-*.cjs` generally run through Playwright tooling; inspect their invocation comments first.

Browser scripts are executor callbacks, not standalone Node programs, and Playwright CLI is prepared separately from project dependencies. Create `output/playwright/` before captures. Scripts that import `/src/` or intercept source modules require `npm run dev`; use a fresh `npm run build` followed by `npm run preview` for production-compatible checks. Record which server, browser, and viewport each result covers.

Use `#scene canvas` for the homepage's main WebGL surface. Entry icons and the ink transition own separate canvases; global canvas selectors are appropriate only in isolated previews or deliberate whole-page resource counts. Include visible calligraphy SVG bounds in layout occlusion checks.

Read navigation destinations from page links for ordinary checks. Intercept the expected destinations with controlled pages and abort unmatched external requests before activating links. Custom-configuration checks must explicitly supply both expected destinations, including `expectedBlogUrl` and `expectedWorldUrl` for `verify-static-links.cjs`.

Passing unit tests, builds, or emulated mobile viewports does not establish physical-device acceptance. Do not claim iPhone Safari compatibility or device performance without corresponding device evidence. For lifecycle changes, verify initialization rejection, runtime fallback, once-only notification, cancellation, resource disposal, background pause, and both entry journeys.

## Commit & Pull Request Guidelines

Recent commits use concise Chinese action summaries, such as `右侧草缺失修复`. Follow this style and keep each commit focused.

Pull requests should explain the problem, resulting behavior, validation commands, and related issues when applicable. Include before/after screenshots and viewport dimensions for visual changes. Preserve established composition and interactions outside the requested scope, and exclude generated captures and build output.
