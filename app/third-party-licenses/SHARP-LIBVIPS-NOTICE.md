# sharp and libvips notice

The Windows desktop distribution contains `@img/sharp-win32-x64` 0.34.5. Its `sharp-win32-x64.node` addon loads these shared libraries from the same directory:

- `libvips-42.dll`
- `libvips-cpp-8.17.3.dll`

The package is licensed as `Apache-2.0 AND LGPL-3.0-or-later`. Its README also identifies included LGPLv3 components. This notice and the accompanying `LGPL-3.0.txt` and `GPL-3.0.txt` apply to those components. Hologram's own code remains available under the MIT License in `LICENSE`.

## Source

The linked source and build information for the bundled release are available without an account:

- sharp 0.34.5: <https://github.com/lovell/sharp/tree/v0.34.5>
- libvips 8.17.3: <https://github.com/libvips/libvips/tree/v8.17.3>
- sharp-libvips build recipe 8.17.3: <https://github.com/lovell/sharp-libvips/tree/v8.17.3>

The last repository records the source components and build procedure for the prebuilt native-library package.

## Replacing the shared libraries

The installed app keeps the addon and DLLs outside the ASAR archive, under:

`resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/`

After closing Hologram, you may replace the two DLLs there with a modified, interface-compatible build that uses the same filenames. Hologram does not verify a hash or signature for these files and does not block their replacement. Keep a backup of the original files; an incompatible replacement can prevent image processing from starting. You may modify the LGPL-covered libraries and reverse engineer the combination when debugging such modifications.
