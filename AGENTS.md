# Project working instructions

Build the browser MMO specified in docs/PROJECT_PLAN.md. Read docs/STATUS.md,
docs/TASKS.md and relevant decisions before resuming. Preserve existing work.

- User explicitly deferred Git on 2026-09-25. Do not initialize Git, commit, or require Git for setup. Pin source content with a reproducible snapshot/hash instead; record unknown upstream revision honestly.
- Include a brief suggested commit message in each completed-chunk handoff, as requested on 2026-09-30. This does not authorize Git operations while Git remains deferred.
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
- Update STATUS.md/TASKS.md with verified state, processes, blockers, and exact next action at handoff.
