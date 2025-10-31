# Repository Guidelines

## Project Structure & Module Organization
Source lives in `src/`. `src/main.ts` wires renderer bootstrap, navigation flow, and panel orchestration. Rendering modules sit under `src/renderer/`, UI controls under `src/components/`, and shared math, timing, and scroll helpers under `src/utils/`. Vertex and fragment shaders (`*.vert`, `*.frag`) belong in `src/shaders/`, while static assets, fonts, and GLTF models ship from `public/`. Keep new modules colocated with their shaders or styles to mirror the existing layout.

## Build, Test, and Development Commands
- `yarn install`: install dependencies once.
- `yarn dev`: launch the Vite dev server with hot reload for rapid iteration.
- `yarn build`: run `tsc` type checks and emit the production bundle to `dist/`.
- `yarn preview`: serve the built bundle from `dist/` for final verification.

## Coding Style & Naming Conventions
Use TypeScript with two-space indentation, semicolons, and ES module named exports when possible. Classes are PascalCase (`OceanRenderer`), functions and instances are camelCase, and file names stay descriptive (`scrollBudget.ts`). Keep public exports minimal; surface only what upstream modules consume. Favor concise inline comments to explain non-obvious math or GPU coordination.

## Testing Guidelines
Automated tests are not yet wired. When adding coverage, place Vitest suites beneath `src/__tests__/` mirroring source paths and use lightweight WebGL mocks. In the meantime, validate features manually via `yarn dev`, paying special attention to GPU-heavy scenes (ocean, wake, glass) and browser console output.

## Commit & Pull Request Guidelines
Write present-tense, concise commits similar to the existing history (`frame budget approach`, `intense cleanup in pipeline`). Group related changes, and avoid mixing UI tweaks with shader adjustments. Pull requests should include: a summary, linked issues, noteworthy performance impacts, before/after captures for visual changes, and documented manual QA steps so reviewers can reproduce the environment quickly.

## Performance & Shader Notes
Keep WebGL workloads off the main thread by extending the frame budgeting helpers in `src/utils/`. Bundle new shaders through `vite-plugin-glsl`, reusing the established precision qualifiers. Large or versioned assets belong in `public/` with hashed filenames to preserve cache behavior.
