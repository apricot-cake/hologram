# Third-Party Notices

## Native libraries in the Windows desktop app

The Windows desktop distribution includes `@img/sharp-win32-x64` 0.34.5. It contains the `sharp-win32-x64.node` addon and the dynamically loaded `libvips-42.dll` and `libvips-cpp-8.17.3.dll` libraries. The package is identified as `Apache-2.0 AND LGPL-3.0-or-later`; its included components also contain the LGPLv3 libraries listed in that package's README.

Hologram itself remains under the [MIT License](../LICENSE). The LGPL terms apply to the bundled native-library components, not to Hologram's own source code.

Each installer places `GPL-3.0.txt`, `LGPL-3.0.txt`, and `SHARP-LIBVIPS-NOTICE.md` in `resources/licenses`. The notice identifies the bundled binaries, gives the source locations, and explains how to replace the shared libraries. The native addon and its DLLs stay outside `app.asar` at `resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/`. Hologram does not check their hash or signature, and accepts an interface-compatible replacement with the same filenames after the app has been closed.

Source and build information for this release are available from [sharp v0.34.5](https://github.com/lovell/sharp/tree/v0.34.5), [libvips v8.17.3](https://github.com/libvips/libvips/tree/v8.17.3), and [the v8.17.3 sharp-libvips build recipe](https://github.com/lovell/sharp-libvips/tree/v8.17.3). The distributed LGPL and GPL texts are the authoritative license copies for this notice.
