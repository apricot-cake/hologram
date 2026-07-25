'use strict';

// BOM-tolerant JSON.parse for file-read parses of library JSON (sidecars,
// organization JSON, .index.json, config, zip org entries). Sidecars and config
// are plain files users may hand-edit, and Windows editors love to prepend a
// UTF-8 BOM — which survives utf8 decoding as a leading U+FEFF and makes bare
// JSON.parse throw. Every such throw path reads as "corrupt/absent": a sidecar
// silently drops out of the library, and in the worst case record:null →
// reconcile permanently purges the captureId from collections (BACKLOG L3).
// Tolerate exactly the BOM; anything else malformed still throws.
function parseJsonLoose(text) {
  return JSON.parse(typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

export { parseJsonLoose };
