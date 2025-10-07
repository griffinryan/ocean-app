# Repository Guidelines

## Project Structure & Module Organization
Source lives in `src/`, with `src/main.ts` bootstrapping renderers, navigation, and panel orchestration. Rendering logic is grouped under `src/renderer/`, while UI controls sit in `src/components/`. Shared math, frame budgeting, and scroll helpers are in `src/utils/`. Shader assets (`*.vert`, `*.frag`) live in `src/shaders/`. Static content, fonts, and GLTF models are served from `public/`; optimized builds land in `dist/` after running the production pipeline.

## Build, Test, and Development Commands
Install dependencies once with `yarn install`. Use `yarn dev` for the hot-reloading Vite server during feature work. Run `yarn build` to type-check via `tsc` and emit the production bundle. Preview the production output with `yarn preview`, which serves the contents of `dist/` using Vite’s static preview server.

## Coding Style & Naming Conventions
Follow the existing TypeScript style: two-space indentation, semicolons, and ES module named exports where possible. Classes use PascalCase (`OceanRenderer`), instances and functions stay camelCase. Co-locate supporting shaders, styles, or configuration files with the TypeScript module that consumes them, mirroring patterns in `renderer/` and `components/`. Keep public API surfaces minimal by exporting only what `src/main.ts` or higher-level modules need.

## Testing Guidelines
Automated tests are not yet wired in; exercise new work manually through `yarn dev` and confirm GPU-intensive scenes (ocean, wake, glass pipelines) render without console warnings. When adding verification, prefer lightweight canvas assertions (e.g., using Vitest + WebGL mocks) and place them under a future `src/__tests__/` directory mirroring module paths. Document manual validation steps in the pull request if coverage is unavailable.

## Commit & Pull Request Guidelines
Match the concise, present-tense commit style already in history (e.g., `frame budget approach`, `intense cleanup in pipeline`). Group related changes and avoid mixing shader tweaks with UI updates in the same commit. Pull requests should include: a summary, linked issues (if any), noteworthy performance impacts, and before/after visuals for shader or layout changes. Note any manual QA steps taken, especially across browsers or devices, so reviewers can reproduce the setup quickly.

## Performance & Shader Notes
Keep heavy WebGL work off the main thread by extending the existing frame budgeting utilities. When introducing new shaders, bundle them through the `vite-plugin-glsl` pipeline and verify precision qualifiers align with the existing ones in `src/shaders/`. Large assets belong in `public/` with hashed filenames to keep cache behavior predictable.
