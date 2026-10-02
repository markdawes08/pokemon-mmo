# Project working instructions

Build the browser MMO specified in docs/PROJECT_PLAN.md. Read docs/STATUS.md,
docs/TASKS.md and relevant decisions before resuming. Preserve existing work.

- User clarified Git permission on 2026-10-02: read-only observation (status, diff, log, show, branch/revision inspection) is allowed. Do not add/stage, commit, push, initialize, or perform other Git mutations. Preserve user commits and work. Keep source content pinned by its reproducible snapshot/hash; record unknown upstream revision honestly.
- Include a brief suggested commit message in each completed-chunk handoff, as requested on 2026-09-30. This does not authorize staging, committing or pushing.
- User reprioritized playable battle testing on 2026-10-02. Deliver the in-game practice loop before more private-only mechanics, then resume the project plan. Every new supported move/Pokemon mechanic must be exposed for immediate manual testing in that loop in the same chunk; preserve the separate normal progression/reward requirements.
- User requested credential-free local testing on 2026-10-02. Preserve the Play as ADMINA / ADMINB shortcut and selected-session restoration; routine testing must not require email/password entry. Keep it limited to the fixed local development fixtures with ordinary gameplay permissions.
- Use TypeScript, Phaser, Vite, Colyseus and real PostgreSQL as specified.
- Use PowerShell-compatible commands and portable Node/Python orchestration.
- Keep C:/Users/mrkda/Projects/pokefirered-master read-only.
- Check installed API types/documentation before using version-sensitive APIs.
- Authoritative gameplay belongs on the server. P02 local movement is a clearly identified renderer preview only.
- Preserve package boundaries: browser cannot import database/server/private data.
- Fail unsupported required content explicitly; never claim placeholders are implemented gameplay.
- Work locally. No public publishing or paid services are authorized.
- Run focused checks and phase gates. Record actual results and unverified scope.
- Use `npm.cmd run verify:focus -- --area battle --profile mirror` for current battle work; select app/content/tooling for other areas. Preserve the complete current engine's control/recovery checks. Use `npm.cmd run verify` for milestones, shared gameplay/storage/protocol changes or uncertain impact; use `--force` after manually changing installed dependencies. Cached results require unchanged inputs, outputs, tool identity and dependency evidence; database/browser/health checks always run fresh.
- Keep chunks bounded and expose each gameplay addition in practice. Report timings from the reusable verifier; do not create pass-numbered runners/finalizers, repeat a successful broad suite without a changed input or unresolved concern, or grow STATUS/TASKS into test transcripts. Keep exact counts and historical evidence in reports and engine contracts.
- Update STATUS.md/TASKS.md with verified state, processes, blockers, and exact next action at handoff.
