"""Check if the Chrome extension and page need reloading.

Computes a build hash from source files on disk and prints the expected value.
Compare with the hash shown in the extension's options page or DOM attribute
(document.documentElement.dataset.postSnapBuild) to detect stale loads.

Usage:
  python scripts/check-reload.py
"""

import hashlib
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BUILD_FILES = ["background.js", "content.js", "manifest.json", "viewer.html", "viewer.js"]


def compute_hash():
    combined = ""
    for f in BUILD_FILES:
        path = os.path.join(BASE, f)
        with open(path, encoding="utf-8") as fh:
            combined += fh.read().replace("\r\n", "\n")

    digest = hashlib.sha256(combined.encode("utf-8")).digest()
    return "".join(f"{b:02x}" for b in digest[:4])


if __name__ == "__main__":
    expected = compute_hash()
    print(f"Expected build hash: {expected}")
    print()
    print("To verify:")
    print("  1. Extension reload: compare with options page 'Build: ...' or service worker console")
    print("  2. Page reload:      compare with document.documentElement.dataset.postSnapBuild")
    print()
    print("If hashes differ, reload the extension and/or the page.")
