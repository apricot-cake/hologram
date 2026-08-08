# Security Policy

## Supported versions

Only the latest published release receives security fixes. Older versions are not maintained in parallel.

## Reporting a vulnerability

Please report security issues privately through GitHub, using the **[Report a vulnerability](https://github.com/apricot-cake/hologram/security/advisories/new)** button on this repository's Security tab.

**Do not open a regular issue or pull request for a security problem.** Reproduction steps, proof-of-concept code, and details of an unfixed weakness are all things that should stay private until a fix is available.

Useful things to include, as far as you can:

- Which component is affected — the Electron app, the browser extension, or the native messaging host
- The version you are running, and your OS and browser
- What an attacker gains, and what access they need to get there
- Steps to reproduce, ideally against a throwaway library rather than your real one

## What to expect

Reports are reviewed privately in a draft security advisory. We will confirm the report, work on a fix there, and coordinate disclosure once a fixed version is available.

We do not commit to a fixed response time or a fixed patch deadline. Whether an advisory is published, and whether a CVE is requested, is decided per case — based on whether a published version is affected and whether users need to be notified.

## Scope notes

Hologram stores your library as ordinary files in a folder you choose, and sends nothing to any server of ours. Reports that are especially relevant include anything that lets a web page reach the native messaging host or the local library beyond what saving a post requires, anything that writes outside the configured library folder, and anything that leaks the contents of your library to a remote host.

Vulnerabilities in third-party dependencies should be reported to the project that maintains them. If a dependency issue affects Hologram specifically — for example through how we call it — a report here is welcome.
