"""Verify sidecar metadata against actual post data via public APIs.

Reads <id>.json sidecars from the Corpus save folder (configured by the
desktop app) and compares them with live data from the Bluesky / Misskey public
APIs. Also checks each sidecar has its paired <id>.jpg.

Usage:
  python verify-store.py                    # Check latest file
  python verify-store.py path/to/file.json  # Check specific sidecar
  python verify-store.py --recent N         # Check latest N files
"""

import sys
import os
import io
import glob
import json
import re
import urllib.request
import urllib.parse
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def config_dir():
    # Must match native-host/paths.js configDir(): CORPUS_CONFIG_DIR wins, else
    # per-OS default. Windows is OUT of %APPDATA% (MSIX storage virtualization).
    override = os.environ.get("CORPUS_CONFIG_DIR")
    if override:
        return override
    if os.name == "nt":
        return os.path.join(os.path.expanduser("~"), ".corpus")
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "Corpus")
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "Corpus")


def save_folder():
    try:
        with open(os.path.join(config_dir(), "config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        if cfg.get("saveFolder"):
            return cfg["saveFolder"]
    except Exception:
        pass
    # default library dir — must match native-host/paths.js defaultLibraryDir()
    if os.name == "nt":
        return os.path.join(os.path.expanduser("~"), "Corpus", "library")
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "Corpus", "library")
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "Corpus", "library")


def parse_post_url(url):
    if not url:
        return None
    m = re.match(r"https://bsky\.app/profile/([^/]+)/post/([^/?#]+)", url)
    if m:
        return {"platform": "bluesky", "handle": m.group(1), "postId": m.group(2)}
    m = re.match(r"https://x\.com/([^/]+)/status/(\d+)", url)
    if m:
        return {"platform": "x", "screenName": m.group(1), "postId": m.group(2)}
    m = re.match(r"https://([^/]+)/notes/([^/?#]+)", url)
    if m:
        return {"platform": "misskey", "host": m.group(1), "noteId": m.group(2)}
    return None


def api_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "verify-store/1.0"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


def api_post(url, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "User-Agent": "verify-store/1.0",
    })
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


def fetch_bluesky_post(handle, post_id):
    at_uri = f"at://{handle}/app.bsky.feed.post/{post_id}"
    url = f"https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri={urllib.parse.quote(at_uri)}&depth=0"
    data = api_get(url)
    post = data.get("thread", {}).get("post", {})
    author = post.get("author", {})
    record = post.get("record", {})
    return {
        "displayName": author.get("displayName", ""),
        "handle": author.get("handle", ""),
        "did": author.get("did", ""),
        "text": record.get("text", ""),
        "createdAt": record.get("createdAt", ""),
        "likeCount": post.get("likeCount", 0),
        "repostCount": post.get("repostCount", 0),
        "replyCount": post.get("replyCount", 0),
    }


def fetch_misskey_note(host, note_id):
    url = f"https://{host}/api/notes/show"
    data = api_post(url, {"noteId": note_id})
    user = data.get("user", {})
    reactions = data.get("reactions", {})
    reaction_total = sum(reactions.values()) if reactions else 0
    return {
        "displayName": user.get("name", ""),
        "screenName": user.get("username", ""),
        "userId": user.get("id", ""),
        "text": data.get("text", "") or "",
        "createdAt": data.get("createdAt", ""),
        "likeCount": reaction_total,
        "repostCount": data.get("renoteCount", 0),
        "replyCount": data.get("repliesCount", 0),
    }


def compare(label, expected, actual, partial=False):
    if not expected and not actual:
        return True, f"  [--] {label:20s} (both empty)"
    expected, actual = str(expected or ""), str(actual or "")
    ok = (expected in actual or actual in expected) if partial else (expected == actual)
    mark = "OK" if ok else "NG"
    if ok:
        return True, f"  [{mark}] {label:20s} {actual[:70]}"
    return False, f"  [{mark}] {label:20s}\n        expected: {expected[:70]}\n        actual:   {actual[:70]}"


def compare_count(label, api_count, value):
    if value is None:
        return True, f"  [--] {label:20s} (not in sidecar)"
    if api_count is None:
        return True, f"  [--] {label:20s} sidecar={value} (no API data)"
    if api_count == value:
        return True, f"  [OK] {label:20s} {value}"
    return True, f"  [~~] {label:20s} sidecar={value} API={api_count} (counts change over time)"


def compare_datetime(label, api_dt, sidecar_dt):
    if not api_dt or not sidecar_dt:
        return compare(label, api_dt, sidecar_dt)
    try:
        a = datetime.fromisoformat(api_dt[:19].replace("Z", ""))
        s = datetime.fromisoformat(sidecar_dt[:19].replace("Z", ""))
        diff = abs((a - s).total_seconds())
        if diff <= 86400:
            return True, f"  [OK] {label:20s} {sidecar_dt}"
        return False, f"  [NG] {label:20s}\n        expected: {api_dt}\n        actual:   {sidecar_dt} (diff: {int(diff)}s)"
    except Exception:
        return compare(label, api_dt, sidecar_dt)


def check_file(path):
    filename = os.path.basename(path)
    print(f"\n{'=' * 60}\n  {filename}\n{'=' * 60}")

    try:
        with open(path, encoding="utf-8") as f:
            meta = json.load(f)
    except Exception as e:
        print(f"  [SKIP] Cannot read sidecar: {e}")
        return None

    # Paired image must exist.
    image = meta.get("image") or (os.path.splitext(filename)[0] + ".jpg")
    img_path = os.path.join(os.path.dirname(path), image)
    if os.path.exists(img_path):
        print(f"  [OK] image                 {image}")
    else:
        print(f"  [NG] image                 MISSING ({image})")

    parsed = parse_post_url(meta.get("url", ""))
    if not parsed:
        print(f"  [SKIP] Cannot parse URL: {str(meta.get('url'))[:60]}")
        return None

    platform = parsed["platform"]
    print(f"  Platform: {platform}\n  URL: {str(meta.get('url'))[:70]}")

    results = []
    try:
        if platform == "bluesky":
            actual = fetch_bluesky_post(parsed["handle"], parsed["postId"])
            results.append(compare("displayName", actual["displayName"], meta.get("displayName")))
            results.append(compare("screenName", actual["handle"], meta.get("screenName")))
            results.append(compare("userId (DID)", actual["did"], meta.get("userId")))
            results.append(compare("text", actual["text"], meta.get("text"), partial=True))
            results.append(compare_datetime("date", actual["createdAt"], meta.get("date")))
            results.append(compare_count("likes", actual["likeCount"], meta.get("likes")))
            results.append(compare_count("reposts", actual["repostCount"], meta.get("reposts")))
            results.append(compare_count("replies", actual["replyCount"], meta.get("replies")))
        elif platform == "misskey":
            actual = fetch_misskey_note(parsed["host"], parsed["noteId"])
            results.append(compare("displayName", actual["displayName"], meta.get("displayName")))
            results.append(compare("screenName", actual["screenName"], meta.get("screenName")))
            results.append(compare("userId", actual["userId"], meta.get("userId")))
            results.append(compare("text", actual["text"], meta.get("text"), partial=True))
            results.append(compare_datetime("date", actual["createdAt"], meta.get("date")))
            results.append(compare_count("likes", actual["likeCount"], meta.get("likes")))
            results.append(compare_count("reposts", actual["repostCount"], meta.get("reposts")))
            results.append(compare_count("replies", actual["replyCount"], meta.get("replies")))
        elif platform == "x":
            results.append(compare("screenName", parsed["screenName"], meta.get("screenName")))
            print("  [INFO] X has no public API - screenName verified from URL only")
            print("  [INFO] displayName, text, userId require manual verification")
    except Exception as e:
        print(f"  [ERR] API error: {e}")
        return None

    all_ok = True
    for ok, msg in results:
        print(msg)
        if not ok:
            all_ok = False

    print("\n  Sidecar metadata:")
    for key in ["captureId", "image", "url", "platform", "text", "displayName", "screenName",
                "userId", "likes", "reposts", "replies", "bookmarks", "views", "date",
                "capturedAt", "mediaType", "lang", "isReply", "isQuote", "isThread",
                "quotedUrl", "tags"]:
        val = meta.get(key)
        if val is not None:
            print(f"    {key:16s} {str(val)[:70]}")

    print(f"\n  Result: {'PASS' if all_ok else 'FAIL'}")
    return all_ok


def main():
    folder = save_folder()
    if len(sys.argv) > 1 and sys.argv[1] == "--recent":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
        files = sorted(glob.glob(os.path.join(folder, "*.json")), key=os.path.getmtime, reverse=True)[:n]
        files.reverse()
    elif len(sys.argv) > 1:
        files = [sys.argv[1]]
    else:
        files = sorted(glob.glob(os.path.join(folder, "*.json")), key=os.path.getmtime, reverse=True)[:1]

    files = [f for f in files if os.path.basename(f) not in ("config.json", ".index.json")]

    if not files:
        print(f"No sidecar (.json) files found in {folder}")
        return

    results = []
    for f in files:
        results.append((os.path.basename(f), check_file(f)))

    if len(results) > 1:
        passed = sum(1 for _, ok in results if ok is True)
        skipped = sum(1 for _, ok in results if ok is None)
        failed = sum(1 for _, ok in results if ok is False)
        print(f"\n{'=' * 60}\n  Summary: {passed} passed, {failed} failed, {skipped} skipped\n{'=' * 60}")
        for name, ok in results:
            status = "PASS" if ok is True else "FAIL" if ok is False else "SKIP"
            print(f"  {status}  {name}")


if __name__ == "__main__":
    main()
