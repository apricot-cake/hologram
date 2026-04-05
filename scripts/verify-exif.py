"""Verify EXIF metadata against actual post data via public APIs.

Usage:
  python verify-exif.py                    # Check latest file
  python verify-exif.py path/to/file.jpg   # Check specific file
  python verify-exif.py --recent N         # Check latest N files
"""

import sys
import os
import io
import glob
import json
import re
import urllib.request
import urllib.parse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from PIL import Image

SAVE_DIR = os.path.expanduser("~/Downloads/Post Snap")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_FILES = ["background.js", "content.js", "manifest.json", "viewer.html", "viewer.js"]

FIELDS = {
    40092: "XPComment",
    36867: "DateTimeOriginal",
    305: "Software",
}


def compute_expected_hash():
    combined = ""
    for f in BUILD_FILES:
        path = os.path.join(BASE, f)
        with open(path, encoding="utf-8") as fh:
            combined += fh.read().replace("\r\n", "\n")
    import hashlib
    digest = hashlib.sha256(combined.encode("utf-8")).digest()
    return "".join(f"{b:02x}" for b in digest[:4])


def check_build_hash(software_str):
    """Extract build hash from Software field and compare with source files."""
    m = re.search(r"\[([0-9a-f]{8})\]", software_str or "")
    if not m:
        return None, "  [--] buildHash             (not found in Software field)"

    image_hash = m.group(1)
    expected = compute_expected_hash()
    if image_hash == expected:
        return True, f"  [OK] buildHash             {image_hash}"
    else:
        return False, f"  [NG] buildHash             image={image_hash} disk={expected} *** RELOAD NEEDED ***"


def decode_xp(value):
    if isinstance(value, bytes):
        text = value.decode("utf-16-le", errors="replace").rstrip("\x00")
        # Strip Unicode directional control characters (LRE, PDF, etc.)
        return re.sub(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]", "", text)
    return str(value) if value else ""


def read_exif(path):
    img = Image.open(path)
    raw = img._getexif() or {}

    comment_str = decode_xp(raw.get(40092))
    metadata = {}
    if comment_str:
        try:
            metadata = json.loads(comment_str)
        except json.JSONDecodeError:
            pass

    return {
        "json": metadata,
        "date": raw.get(36867, ""),
        "software": raw.get(305, ""),
    }


def parse_post_url(url):
    """Determine platform and extract IDs from post URL."""
    if not url:
        return None

    # Bluesky
    m = re.match(r"https://bsky\.app/profile/([^/]+)/post/([^/?#]+)", url)
    if m:
        return {"platform": "bluesky", "handle": m.group(1), "postId": m.group(2)}

    # Misskey
    m = re.match(r"https://([^/]+)/notes/([^/?#]+)", url)
    if m:
        return {"platform": "misskey", "host": m.group(1), "noteId": m.group(2)}

    # X/Twitter
    m = re.match(r"https://x\.com/([^/]+)/status/(\d+)", url)
    if m:
        return {"platform": "x", "screenName": m.group(1), "postId": m.group(2)}

    return None


def api_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "verify-exif/1.0"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


def api_post(url, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "User-Agent": "verify-exif/1.0",
    })
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


def parse_exif_datetime(dt_str):
    """Parse EXIF datetime 'YYYY:MM:DD HH:MM:SS' to comparable format."""
    m = re.match(r"(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})", dt_str or "")
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:{m.group(6)}"


def compare_datetime(label, api_dt, exif_dt):
    """Compare datetimes allowing for timezone offset (up to 24h)."""
    if not api_dt or not exif_dt:
        return compare(label, api_dt or "", exif_dt or "")

    from datetime import datetime, timedelta
    try:
        api_time = datetime.fromisoformat(api_dt[:19])
        exif_time = datetime.fromisoformat(exif_dt[:19])
        diff = abs((api_time - exif_time).total_seconds())
        # Allow up to 24h difference for timezone, with up to 60s tolerance for missing seconds
        rounded_diff = round(diff / 3600) * 3600
        if diff <= 86400 and abs(diff - rounded_diff) < 60:
            return True, f"  [OK] {label:20s} {exif_dt} (UTC offset: {int(diff//3600)}h)"
        else:
            return False, f"  [NG] {label:20s}\n        expected: {api_dt}\n        actual:   {exif_dt} (diff: {int(diff)}s)"
    except Exception:
        return compare(label, api_dt, exif_dt)


def fetch_bluesky_post(handle, post_id):
    """Fetch post data from Bluesky public API."""
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
    """Fetch note data from Misskey API."""
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


def compare_count(label, api_count, exif_count):
    """Compare engagement counts. Counts change over time, so only warn on large differences."""
    if exif_count is None:
        return True, f"  [--] {label:20s} (not in EXIF)"
    if api_count is None:
        return True, f"  [--] {label:20s} EXIF={exif_count} (no API data)"

    diff = abs(api_count - exif_count)
    if diff == 0:
        return True, f"  [OK] {label:20s} {exif_count}"
    else:
        return True, f"  [~~] {label:20s} EXIF={exif_count} API={api_count} (counts change over time)"


def compare(label, expected, actual, partial=False):
    if not expected and not actual:
        return True, f"  [--] {label:20s} (both empty)"

    if partial:
        ok = expected in actual or actual in expected
    else:
        ok = expected == actual

    mark = "OK" if ok else "NG"
    if ok:
        return True, f"  [{mark}] {label:20s} {actual[:70]}"
    else:
        return False, f"  [{mark}] {label:20s}\n        expected: {expected[:70]}\n        actual:   {actual[:70]}"


def check_file(path):
    filename = os.path.basename(path)
    print(f"\n{'=' * 60}")
    print(f"  {filename}")
    print(f"{'=' * 60}")

    exif = read_exif(path)

    # Build hash check (extension + page reload verification)
    hash_ok, hash_msg = check_build_hash(exif["software"])
    print(hash_msg)
    if hash_ok is False:
        print(f"\n  Result: STALE (extension or page not reloaded)")
        return False

    meta = exif["json"]
    if not meta:
        print(f"  [SKIP] No JSON metadata in XPComment")
        return None

    post_url = meta.get("url", "")
    parsed = parse_post_url(post_url)

    if not parsed:
        print(f"  [SKIP] Cannot parse URL: {post_url[:60]}")
        return None

    platform = parsed["platform"]
    print(f"  Platform: {platform}")
    print(f"  URL: {post_url[:70]}")

    results = []

    try:
        if platform == "bluesky":
            actual = fetch_bluesky_post(parsed["handle"], parsed["postId"])

            results.append(compare("displayName", actual["displayName"], meta.get("displayName", "")))
            results.append(compare("screenName", actual["handle"], meta.get("screenName", "")))
            results.append(compare("userId (DID)", actual["did"], meta.get("userId", "")))
            results.append(compare("postText", actual["text"], meta.get("text", ""), partial=True))

            exif_dt = parse_exif_datetime(exif["date"])
            actual_dt = actual["createdAt"][:19]
            results.append(compare_datetime("dateTime", actual_dt, exif_dt))

            results.append(compare_count("likes", actual["likeCount"], meta.get("likes")))
            results.append(compare_count("reposts", actual["repostCount"], meta.get("reposts")))
            results.append(compare_count("replies", actual["replyCount"], meta.get("replies")))

        elif platform == "misskey":
            actual = fetch_misskey_note(parsed["host"], parsed["noteId"])

            results.append(compare("displayName", actual["displayName"], meta.get("displayName", "")))
            results.append(compare("screenName", actual["screenName"], meta.get("screenName", "")))
            results.append(compare("userId", actual["userId"], meta.get("userId", "")))
            results.append(compare("postText", actual["text"], meta.get("text", ""), partial=True))

            exif_dt = parse_exif_datetime(exif["date"])
            actual_dt = actual["createdAt"][:19]
            results.append(compare_datetime("dateTime", actual_dt, exif_dt))

            results.append(compare_count("likes", actual["likeCount"], meta.get("likes")))
            results.append(compare_count("reposts", actual["repostCount"], meta.get("reposts")))
            results.append(compare_count("replies", actual["replyCount"], meta.get("replies")))

        elif platform == "x":
            results.append(compare("screenName", parsed["screenName"], meta.get("screenName", "")))
            print(f"  [INFO] X has no public API - screenName verified from URL only")
            print(f"  [INFO] displayName, postText, userId require manual verification")

    except Exception as e:
        print(f"  [ERR] API error: {e}")
        return None

    all_ok = True
    for ok, msg in results:
        print(msg)
        if not ok:
            all_ok = False

    # Show JSON metadata for reference
    print(f"\n  JSON metadata:")
    for key in ["captureId", "url", "platform", "text", "displayName", "screenName", "userId",
                "likes", "reposts", "replies", "bookmarks", "views", "date", "capturedAt",
                "mediaType", "lang", "isReply", "isQuote", "isThread", "quotedUrl", "folder", "tags"]:
        val = meta.get(key)
        if val is not None:
            val_str = str(val)[:70]
            print(f"    {key:16s} {val_str}")
    print(f"  DateTimeOriginal: {exif['date']}")

    print(f"\n  Result: {'PASS' if all_ok else 'FAIL'}")
    return all_ok


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--recent":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
        files = sorted(glob.glob(os.path.join(SAVE_DIR, "*.jpg")) + glob.glob(os.path.join(SAVE_DIR, "images", "*.jpg")), key=os.path.getmtime, reverse=True)[:n]
        files.reverse()
    elif len(sys.argv) > 1:
        files = [sys.argv[1]]
    else:
        files = sorted(glob.glob(os.path.join(SAVE_DIR, "*.jpg")) + glob.glob(os.path.join(SAVE_DIR, "images", "*.jpg")), key=os.path.getmtime, reverse=True)[:1]

    if not files:
        print(f"No .jpg files found in {SAVE_DIR}")
        return

    results = []
    for f in files:
        r = check_file(f)
        results.append((os.path.basename(f), r))

    if len(results) > 1:
        print(f"\n{'=' * 60}")
        passed = sum(1 for _, ok in results if ok is True)
        skipped = sum(1 for _, ok in results if ok is None)
        failed = sum(1 for _, ok in results if ok is False)
        print(f"  Summary: {passed} passed, {failed} failed, {skipped} skipped")
        print(f"{'=' * 60}")
        for name, ok in results:
            status = "PASS" if ok is True else "FAIL" if ok is False else "SKIP"
            print(f"  {status}  {name}")


if __name__ == "__main__":
    main()
