# Privacy Policy — Corpus

## Data Collection

Corpus does **not** collect, store, or transmit any personal data. All captured images and metadata are saved locally to a folder you choose on your device.

## External API Requests

The extension makes read-only requests to the following public APIs to enrich metadata:

- **Bluesky** (`public.api.bsky.app`) — Resolves user handles to DIDs (decentralized identifiers). Only the handle string is sent.
- **Misskey** (`{instance}/api/notes/show`) — Fetches note details (text, author, timestamp) for the instance you are browsing. Only the note ID is sent.

No authentication tokens, cookies, or personal information are included in these requests.

## Permissions

- **activeTab** — Access the current tab only when you activate the extension.
- **scripting** — Inject the post selection UI into the current page.
- **nativeMessaging** — Hand each capture to the Corpus desktop app on your device, which writes the image and its metadata to the folder you chose.

## Data Storage

Captured posts are **not** stored in the browser. Each capture is written to your chosen folder as an image (`<id>.jpg`) plus a metadata sidecar (`<id>.json`) by a local companion app on your device. Only lightweight UI preferences (such as the display language) are kept in the browser's local storage. Nothing is stored in sync storage or sent to any external server.

## Contact

For questions or concerns, please open an issue at https://github.com/apricot-cake/corpus/issues.
