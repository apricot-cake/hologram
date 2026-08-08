// Type reference for scripts/tsconfig.test.json only (it names this file in
// `include`; no runtime code imports it).
//
// The suites that reach extension/utils/background.ts pull in tokens.ts with it,
// and that module imports its CSS with Vite's `?inline` suffix — a specifier only
// vite/client declares. Without it the import is `any`, which is not just one
// TS2307: the `any` then defeats the narrowing in tokens.ts's state() and reports
// a second, unrelated-looking error there.
//
// A `/// <reference types>` rather than an entry in the project's `types` array:
// that project sets `typeRoots`, and TypeScript then resolves every `types` entry
// under those roots only — "vite/client" is not a @types package, so it comes back
// TS2688. A reference directive goes through ordinary module resolution and finds
// the real package. (extension/tsconfig.json can name it in `types` because it
// sets no typeRoots.)
/// <reference types="vite/client" />
