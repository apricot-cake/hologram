#!/usr/bin/env node
// PreToolUse(Bash) guard: block PowerShell here-strings (@'...'@) passed to the Bash tool.
// The Bash tool runs POSIX sh, which does not understand @'...'@, so the opener leaks a
// literal "@" into the commit message. Detect the full here-string signature
// (git commit + opener @' + closer '@) to avoid false positives on normal -m messages.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = (JSON.parse(raw).tool_input || {}).command || "";
  } catch {
    // Not parseable -> stay out of the way (allow).
  }
  const isCommit = cmd.includes("git commit");
  const hasHereString = cmd.includes("@'") && cmd.includes("'@");
  if (isCommit && hasHereString) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "Bash ツールに PowerShell の here-string (@'...'@) は使えません。POSIX sh が解釈して先頭に @ が漏れます。複数行のコミットメッセージは PowerShell ツールで @'...'@ を使うか、Write でメッセージファイルを書いて git commit -F <ファイル> を使ってください。",
        },
      })
    );
  }
});
