# Contributing

Hologram is developed in the open, but it is maintained by one person. That shapes what follows: the issue tracker is a working backlog rather than a discussion venue, and most of what you might want to say belongs somewhere else on this page.

## Where to take things

| What you have | Where it goes |
| --- | --- |
| Something is broken | [Bug report](https://github.com/apricot-cake/hologram/issues/new?template=bug_report.yml) |
| A question — how do I…? | [Discussions → Q&A](https://github.com/apricot-cake/hologram/discussions/categories/q-a) |
| An idea for a feature | [Discussions → Ideas](https://github.com/apricot-cake/hologram/discussions/categories/ideas) |
| A security vulnerability | [Private advisory](https://github.com/apricot-cake/hologram/security/advisories/new) — see [SECURITY.md](SECURITY.md). Never open an issue for this. |
| Anything else | [Discussions → General](https://github.com/apricot-cake/hologram/discussions/categories/general) |

Feature requests live in Ideas, not in the issue tracker. Once a suggestion is going to be worked on it becomes an issue, so the backlog stays a list of things that are actually planned.

If you use the browser extension, the Chrome Web Store listing has its own support form. It needs a Google account rather than a GitHub one, and it only covers the extension.

## Reporting a bug well

The bug form asks for the app version, your OS, and steps to reproduce, because without them a report usually cannot be acted on. Two things to leave out:

- **The path to your library.** It says more about your machine than about the bug.
- **The text or images of a saved post.** A bug can be described without reproducing someone else's content.

The app writes its log to `%APPDATA%\Hologram\logs\main.log`. If you attach part of it, the lines around the failure are enough — the whole file rarely helps and may contain paths you would rather not share.

## Pull requests

Open an issue or a discussion first if the change is more than a fix. A pull request that arrives without warning may be turned down simply because it goes somewhere the project is not going, and that wastes your time more than mine.

Before you push:

```
npm run check
```

That runs Biome, the type checks, and the unit tests. CI runs the same thing, so a green local check usually means a green pull request.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) — `fix(renderer): …`, `docs(privacy): …`. The description after the prefix is normally written in Japanese, but English is perfectly fine; do not let the language stop you from sending a fix.

`docs/build.md` covers getting the app, the extension, and the native messaging host running locally. `docs/architecture.md` explains how the pieces fit together, and `docs/scope.md` says what this project is and is not trying to be — worth reading before proposing something large.

## License

By contributing you agree that your work is licensed under the [MIT License](../LICENSE), the same as the rest of the project.
