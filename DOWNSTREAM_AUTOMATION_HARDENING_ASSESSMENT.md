# Downstream Automation Hardening — Assessment (Section I)

**Superseded — all 3 recommended action items below have since been
implemented.** This file originally recorded a read-only, zero-changes
assessment; a later pass implemented all of it for real:

1. **Refetch+verify** — done. All 4 workflows now mutate labels through a
   shared, single-call-site script (`persist_editing_package_labels.sh`,
   `persist_subtitle_package_labels.sh`, `persist_thumbnail_package_labels.sh`,
   `persist_youtube_publication_package_labels.sh`) that mutates, re-fetches
   the Issue, and verifies every required label is actually present before
   reporting success — never trusting the mutation call's own exit code
   alone.
2. **Generic English label twins** — done, dual-write only, legacy labels
   never removed: `editing-package`/`editing-package-ready`,
   `subtitle-package`/`subtitle-package-ready`,
   `thumbnail-package`/`thumbnail-package-ready`,
   `youtube-publication-package`/`youtube-publication-package-ready`.
3. **Per-workflow mutation-tested hardening** — done:
   `test_editing_package_hardening.mjs`, `test_subtitle_package_hardening.mjs`,
   `test_thumbnail_package_hardening.mjs`, and
   `test_youtube_publication_package_hardening.mjs` each verify — and
   mutation-test to confirm the check actually catches a broken version of
   — actor authorization, source/state/required-label guards, test-mode
   isolation, refetch→verify ordering, and (for the publication workflow)
   the publication gate specifically, all zero-token/zero-network.

The assessment below is kept as the historical record of what was found
and why, not as a current description of these 4 workflows' state — see
the test files above and `PROJECT_STATE.md` for what's actually true today.

---

Read-only assessment of `editing-package-agent.yml`, `subtitle-package-agent.yml`,
`thumbnail-package-agent.yml`, and `youtube-publication-package-agent.yml`
against the filming-package safety standard, **as it stood before the
hardening pass described above**. At the time this assessment was written,
no changes had yet been made to any of these 4 workflows — given the size
of properly hardening each one (new tests, mutation-testing, careful
review) matching the rigor already applied to
filming-package/production-readiness/owner-approval, and given the
explicit priority of not risking the currently-working production
pipeline, it was deliberately an assessment-and-plan deliverable at that
point, not yet an implementation.

## What's already consistent across all 4 (good — verified, not assumed)

- **Authorized-actor check**: all four compare `github.actor` (normalized,
  case-insensitive) against the central config's owner before proceeding.
- **`test_mode` input**: all four accept and validate a boolean `test_mode`
  input, strictly rejecting anything other than literal `true`/`false`.
- **Source-state/required-label preconditions**: each checks for its
  expected upstream label(s) before proceeding (e.g. editing requires
  `ham-video-teslim` + `kurgu-bekliyor`, and separately checks either
  `cekim-paketi`/`filming-package` and either `eren-onayli`/`owner-approved`
  and either `cekime-hazir`/`production-ready` — already dual-read for
  labels that came from an *already-migrated* upstream stage).
- **Dedup via `EXISTING_NUMBER`**: each searches for an existing output
  Issue by title before creating a new one, matching the pattern used
  elsewhere in this project.

## Gaps found (concrete, cited, consistent across all 4)

### 1. No REFETCH → VERIFY after label mutations (all 4)

None of the four workflows re-fetch the Issue after `gh issue edit
--add-label ...` and confirm the labels actually landed — they trust the
mutation call's own exit code, the exact pattern that was found to be
insufficient during this hardening pass for `eren-approval-gate.yml`
(Section E) and for the appointment DB index (Section B2 — where trusting
the operation's own apparent success without independently verifying the
result hid the fact that the index had never built at all). This is the
single highest-value fix to bring these workflows up to the same standard.

### 2. The 4 workflows' own package/ready labels have no generic English twin

| Workflow | Legacy-only labels found | Generic twin? |
|---|---|---|
| `editing-package-agent.yml` | `kurgu-paketi`, `kurgu-plani-hazir` | ❌ none |
| `subtitle-package-agent.yml` | `altyazi-paketi`, `altyazi-paketi-hazir` | ❌ none |
| `thumbnail-package-agent.yml` | `thumbnail-paketi`, `thumbnail-paketi-hazir` | ❌ none |
| `youtube-publication-package-agent.yml` | `youtube-yayin-paketi`, `youtube-yayin-paketi-hazir` | ❌ none |

Note: `youtube-publication-package-agent.yml` **does** already dual-write
`eren-yayin-onayi-bekliyor` / `publication-approval-pending` — that pair was
already migrated in an earlier phase of this project (Publication Approval
Label Migration). Only each workflow's *own* package-identity/ready labels
are still legacy-only.

This is a smaller-scope version of exactly the migration already done for
`cekim-paketi`→`filming-package`, `cekime-hazir`→`production-ready`, etc. —
same pattern, just not yet extended to these 4.

### 3. Not independently re-verified in this pass (would need per-workflow review, not assumed safe or unsafe)

- **Test-mode side-effect isolation**: `test_mode` is present and validated,
  but whether it fully prevents every write (label mutation, Issue
  creation/comment) the same way filming-package's `test_mode` does was not
  re-verified line-by-line for all 4 in this pass.
- **Stale/ambiguous source rejection**: whether each workflow rejects a
  source Issue whose body doesn't match an expected marker/hash (like
  filming-package's `source-body-sha256` check) was not independently
  re-verified for all 4.
- **Duplicate-output dedup correctness**: `EXISTING_NUMBER` search exists,
  but whether its matching logic can ever mismatch (like the exact-title
  dependency filming-package's own dedup relies on) wasn't re-checked here.

## Recommended order for a future hardening pass

1. **Add refetch+verify to all 4** (mechanical, same pattern already proven
   in Section E and the filming-package script) — highest value, lowest
   risk, since it only adds a check after existing successful mutations
   rather than changing any mutation logic.
2. **Add generic label twins** for each workflow's own package/ready labels,
   dual-write only (no legacy removal), matching the exact established
   migration pattern — do these one workflow at a time, each with its own
   zero-token test and smoke-suite wiring, exactly like every prior label
   migration in this project.
3. Only then, per-workflow deep review of test-mode isolation and
   stale-source rejection, with dedicated mutation tests for each (auth
   guard removed, source guard removed, test marker removed, AI gate
   opened, publication gate bypassed, a second mutation command injected,
   final verification removed — all must FAIL, per the standard already
   established for filming-package).

## What was verified in this pass (read-only, zero changes)

- `generation_dispatch_enabled: false` is unchanged and still enforced by
  `validate_video_orchestrator.py`'s own required-false check (Section J).
- None of the 4 workflows were modified.
- No AI/paid API/video generation/YouTube call was made while producing
  this assessment.
