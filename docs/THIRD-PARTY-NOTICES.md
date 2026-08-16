# Third-Party Notices

Hologram's optional AI features (Settings → AI Features, off by default — see [PRIVACY.md](PRIVACY.md)) run inference locally using models downloaded from Hugging Face on request. Each model's license is listed here as it is downloaded, and shown next to it in Settings → AI Features.

The Models section is generated from the code-owned model registry (`app/src/main/lib-model-registry.ts`, #832) — `scripts/model-registry.test.ts` checks the entries below stay in sync with it.

## Native libraries in the Windows desktop app

The Windows desktop distribution includes `@img/sharp-win32-x64` 0.34.5. It contains the `sharp-win32-x64.node` addon and the dynamically loaded `libvips-42.dll` and `libvips-cpp-8.17.3.dll` libraries. The package is identified as `Apache-2.0 AND LGPL-3.0-or-later`; its included components also contain the LGPLv3 libraries listed in that package's README.

Hologram itself remains under the [MIT License](../LICENSE). The LGPL terms apply to the bundled native-library components, not to Hologram's own source code.

Each installer places `GPL-3.0.txt`, `LGPL-3.0.txt`, and `SHARP-LIBVIPS-NOTICE.md` in `resources/licenses`. The notice identifies the bundled binaries, gives the source locations, and explains how to replace the shared libraries. The native addon and its DLLs stay outside `app.asar` at `resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/`. Hologram does not check their hash or signature, and accepts an interface-compatible replacement with the same filenames after the app has been closed.

Source and build information for this release are available from [sharp v0.34.5](https://github.com/lovell/sharp/tree/v0.34.5), [libvips v8.17.3](https://github.com/libvips/libvips/tree/v8.17.3), and [the v8.17.3 sharp-libvips build recipe](https://github.com/lovell/sharp-libvips/tree/v8.17.3). The distributed LGPL and GPL texts are the authoritative license copies for this notice.

## Models

- **Xenova/all-MiniLM-L6-v2** ([huggingface.co/Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)) — Apache License 2.0 - sentence-transformers/all-MiniLM-L6-v2 (ONNX port: Xenova/all-MiniLM-L6-v2)
- **SmilingWolf/wd-vit-tagger-v3** ([huggingface.co/SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3)) — Apache License 2.0 - SmilingWolf/wd-vit-tagger-v3 (trained on Danbooru images)

  The model card states the weights were trained on images from Danbooru (up to image ID 7220105, tags as of 2024-02-28). The model itself is offered under the Apache License 2.0; the rights position of the training data is a separate question that the license does not settle, and is recorded here rather than left out.
