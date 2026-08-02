// WHICH native messaging host this build talks to (#732).
//
// Native messaging routes on the HOST NAME, not on the extension id: Chrome
// looks the name up in the per-user registration, reads that host's manifest,
// and only then checks the manifest's allowed_origins against the extension
// asking. So two builds of the SAME extension — same fixed key, same id, same
// chrome.storage, same keyboard shortcuts — reach two different hosts, two
// different config dirs and two different libraries just by asking for
// different names.
//
// That is what keeps a capture made while developing out of the real library.
// The development host is registered separately (scripts/register-dev-native-host.cts)
// and its launcher pins HOLOGRAM_CONFIG_DIR at ~/.hologram-dev, so the bridge it
// starts cannot see the real one even by accident.
//
// DECIDED BY THE COMMAND, NOT BY THE ENVIRONMENT. The value arrives through a
// `define` that extension/wxt.config.ts sets from Vite's own `command`
// (serve = development, build = release). `import.meta.env.DEV` looks like the
// obvious way to write this and is a TRAP: it follows NODE_ENV, so a release
// build produced from a test runner (vitest's global setup builds the extension)
// would come out asking for the DEVELOPMENT host. That is not hypothetical — it
// happened while writing this, and the release check in
// scripts/build-extension.cts is what caught it. That check stays: a release
// bundle must not contain the development name at all, which also protects the
// extension E2E harness, whose isolation works by rewriting the release host
// name in the built bundle.
//
// `typeof` rather than a plain read because an undeclared identifier is a
// ReferenceError while `typeof` on one is legal — that is the case for a Vitest
// suite importing this module directly, and the release name is the right answer
// there.
declare const __HOLOGRAM_NATIVE_HOST__: string | undefined;

export const RELEASE_NATIVE_HOST = 'com.hologram.host';
export const DEV_NATIVE_HOST = 'com.hologram.host.dev';

export const NATIVE_HOST: string = typeof __HOLOGRAM_NATIVE_HOST__ === 'undefined' || !__HOLOGRAM_NATIVE_HOST__ ? RELEASE_NATIVE_HOST : __HOLOGRAM_NATIVE_HOST__;
