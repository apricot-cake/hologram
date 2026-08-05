# Third-Party Notices

Hologram's optional AI features (Settings → AI Features, off by default — see [PRIVACY.md](PRIVACY.md)) run inference locally using models downloaded from Hugging Face on request. Each model's license is listed here as it is downloaded, and shown next to it in Settings → AI Features.

This list is generated from the code-owned model registry (`app/src/main/lib-model-registry.ts`, #832) — `scripts/model-registry.test.ts` checks the entries below stay in sync with it.

## Models

- **Xenova/all-MiniLM-L6-v2** ([huggingface.co/Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)) — Apache License 2.0 - sentence-transformers/all-MiniLM-L6-v2 (ONNX port: Xenova/all-MiniLM-L6-v2)
- **SmilingWolf/wd-vit-tagger-v3** ([huggingface.co/SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3)) — Apache License 2.0 - SmilingWolf/wd-vit-tagger-v3 (trained on Danbooru images)

  The model card states the weights were trained on images from Danbooru (up to image ID 7220105, tags as of 2024-02-28). The model itself is offered under the Apache License 2.0; the rights position of the training data is a separate question that the license does not settle, and is recorded here rather than left out.
