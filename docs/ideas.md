---
type: ideas
project: codeburn
tags:
  - project/codeburn
  - type/ideas
created: 2026-05-04
modified: 2026-05-04
---

# Ideas: codeburn

Ideas generated during sessions. Not committed to scope — requires human approval to promote to stages.md.

---

- **Windows path detection audit** — verify all 18 providers correctly resolve `%APPDATA%`, `%LOCALAPPDATA%`, and `%USERPROFILE%` paths on Windows 11; fix any that silently return zero sessions.
- **`codeburn yield` git integration on Windows** — `yield` correlates sessions with git commits; test and fix any WSL/Git-for-Windows path mismatch that breaks commit detection on this machine.
- **Shell completion** — add `codeburn completions bash/zsh/fish/powershell` command via Commander.js `.addHelpText` + completion script generation; improves DX significantly.
- **`--json` flag on `optimize`** — `optimize` currently has no machine-readable output; adding `--format json` would allow piping findings into automation or the workspace metrics pipeline.
- **Workspace metrics integration** — write a small script that runs `codeburn today --format json` and appends a row to `metrics/session-tokens.md` automatically, replacing the manual stop-hook approach.
- **`codeburn status` as stop-hook output** — wire `codeburn status --format json` into the workspace stop hook so every session close-out captures real token costs from codeburn rather than Claude's estimate.
- **New provider: Claude Code on Windows** — verify the Windows path (`%APPDATA%\Claude\projects\`) is correctly detected; open a PR upstream if broken.
