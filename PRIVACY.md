# Privacy Policy — Post Snap

## Data Collection

Post Snap does **not** collect, store, or transmit any personal data. All captured images and metadata are saved locally to your device's downloads folder.

## External API Requests

The extension makes read-only requests to the following public APIs to enrich metadata:

- **Bluesky** (`public.api.bsky.app`) — Resolves user handles to DIDs (decentralized identifiers). Only the handle string is sent.
- **Misskey** (`{instance}/api/notes/show`) — Fetches note details (text, author, timestamp) for the instance you are browsing. Only the note ID is sent.

No authentication tokens, cookies, or personal information are included in these requests.

## Permissions

- **activeTab** — Access the current tab only when you activate the extension.
- **scripting** — Inject the post selection UI into the current page.
- **downloads** — Save captured images to your downloads folder.

## Data Storage

No data is stored in the browser's local storage, sync storage, or any external server. Saved images reside only in your local downloads folder.

## Contact

For questions or concerns, please open an issue at https://github.com/apricot-cake/post-snap/issues.
