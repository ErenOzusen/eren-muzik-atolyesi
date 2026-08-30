# AI Router Migration Plan

This documents which GitHub Actions workflows call an AI provider directly
(bypassing the central multi-provider router, `.github/scripts/ai_router.py`)
today, and which of those are safe to migrate. Each migration was real,
individually-scoped work of its own, given the same care the
filming-package migration to the router originally got (prompt equivalence,
token accounting, quality-contract behavior, and fallback re-verified per
workflow) — see the zero-token `test_*_router_migration.mjs` file next to
each migrated workflow for the executable proof.

## Current state (verified from source, not assumed)

| Workflow | Calls AI? | How | Router-eligible? |
|---|---|---|---|
| `filming-package-agent-v4-router.yml` | Yes | **Already on `ai_router.py`** | — done |
| `weekly-content-research.yml` | Yes | **Migrated to `ai_router.py`** (`test_weekly_content_research_router_migration.mjs`) | ✅ done |
| `weekly-script-agent.yml` | Yes | **Migrated to `ai_router.py`** (`test_weekly_script_agent_router_migration.mjs`) | ✅ done |
| `weekly-script-correction.yml` | Yes | **Migrated to `ai_router.py`** (`test_weekly_script_correction_router_migration.mjs`) | ✅ done |
| `final-technical-check.yml` | Yes | **Migrated to `ai_router.py`** (`test_final_technical_check_router_migration.mjs`) | ✅ done |
| `editing-package-agent.yml` | Yes | **Migrated to `ai_router.py`** (`test_editing_package_router_migration.mjs`) | ✅ done |
| `weekly-quality-control.yml` | Yes | Direct `curl`, uses Anthropic's native `web_search_20260209` tool with a config-driven `max_web_searches` limit | ❌ **Not yet — see blocker below** |
| `subtitle-package-agent.yml` | No | Deterministic Python (`build_subtitle_package.py`) | n/a |
| `thumbnail-package-agent.yml` | No | Deterministic Python (`build_thumbnail_package.py`) | n/a |
| `youtube-publication-package-agent.yml` | No | Deterministic Python (`build_youtube_package.py`) | n/a |

## Category A — Router-eligible (5 workflows) — all 5 migrated

`weekly-content-research.yml`, `weekly-script-agent.yml`,
`weekly-script-correction.yml`, `final-technical-check.yml`,
`editing-package-agent.yml`.

Each of these already reported `web_search=0` in its own usage marker
comment before migration — confirming none used (or needed) any
provider-specific capability the router doesn't support. **Correction to
this plan's original claim:** only `weekly-script-correction.yml`,
`final-technical-check.yml`, and `editing-package-agent.yml` actually
separated a real `system` field from the user `messages` content in their
direct `curl` payload; `weekly-content-research.yml` and
`weekly-script-agent.yml` sent a single user-role message with no system
prompt at all (verified by reading each workflow's own request-building
step, not assumed from this plan). Each migration preserved whichever
shape that workflow actually had — `--system-file` is only passed for the
three that had a real system prompt.

**Per-workflow migration checklist (verified individually for each of the
5, not as a one-time blanket check):**

1. **Prompt equivalence** — the exact system prompt (where one existed)
   and user/content prompt text sent to Anthropic before migration is
   byte-identical to what's now sent through the router; verified by
   asserting the literal prompt-construction fragments survived in each
   workflow's own zero-token migration test.
2. **System/user separation** — the router's `--system-file` /
   `--prompt-file` split matches each direct call's original `system` /
   `messages` split exactly (no accidental content moved between the two,
   and no system prompt invented for the two workflows that never had one).
3. **Token accounting** — each workflow's own `*_AI_USAGE_V1` /
   `AGENT_USAGE_V1` comment marker now reads `total_input_tokens` /
   `total_output_tokens` from the router's meta-file (falling back to
   `input_tokens`/`output_tokens`), and now also reports the ACTUAL
   `provider`/`model` that answered (not just the originally-requested
   primary model), since a fallback provider may differ from it.
4. **Quality validation** — every workflow's own pre-existing structural/
   output-contract checks (required headings, section counts, QC-evidence
   packets, forbidden false claims, etc.) are untouched and still run,
   unchanged, on the router's own `--output-file`.
5. **Fallback simulation** — the router's own provider-fallback and
   quality-rejection-fallback behavior is covered once, generically, by
   `test_ai_router.py`'s zero-network unit tests (429 retry, non-retryable
   fallthrough, quality-rejection fallthrough); each workflow's own
   migration test additionally proves that workflow's specific transport
   wiring (flags, guards, markers) is correct, rather than re-simulating
   provider HTTP failures per workflow.
6. **Zero-token test** — `test_weekly_content_research_router_migration.mjs`,
   `test_weekly_script_agent_router_migration.mjs`,
   `test_weekly_script_correction_router_migration.mjs`,
   `test_final_technical_check_router_migration.mjs`, and
   `test_editing_package_router_migration.mjs` — all five run in the
   business-profile smoke suite.
7. **`test_mode` behavior preserved, not upgraded** — this migration
   preserved each workflow's pre-existing `test_mode` semantics exactly,
   rather than changing them. For `weekly-content-research.yml`,
   `weekly-script-agent.yml`, `weekly-script-correction.yml`, and
   `final-technical-check.yml`, `test_mode=true` fully skips the AI-calling
   step (0 provider calls), unchanged. **`editing-package-agent.yml` is a
   known exception, not fixed by this migration:** its AI-calling step is
   gated on `env.SKIP_EDITING != 'true'` (an idempotency/cache guard, not
   `TEST_MODE`), so a first-time `test_mode=true` run still reaches the
   real router call and can still make one real, billable provider call
   (against a fixture filming package, not real intake data). This is a
   pre-existing gap relative to the "AI unreachable in test mode" bar that
   `filming-package-agent-v4-router.yml`'s own `TEST_MODE`-gated steps set,
   discovered while migrating this workflow's transport. Closing it
   requires designing a deterministic fixture `editing-package.md` that
   satisfies all of this workflow's own structural checks so the
   downstream label-persistence/comment steps keep working when the AI
   call is skipped — a distinct piece of hardening work, intentionally not
   bundled into this transport migration, and still open.

## Category B — Not yet migratable (1 workflow)

`weekly-quality-control.yml`.

**Blocker:** `ai_router.py` has zero support for any provider's web-search
tool (`call_anthropic` and `call_openai_chat` in `ai_router.py` accept no
`tools`/web-search parameter at all — confirmed by reading the source, not
assumed). QC's own config (`content.quality_control.max_web_searches` in
`business-profile.json`) is read directly into Anthropic's native
`web_search_20260209` tool block. Migrating this workflow to the router
today would silently drop web search entirely, which is explicitly
unacceptable.

**What would need to happen before this can move:** `ai_router.py` would
need a new, optional `--enable-web-search` (or similar) capability that
(a) is provider-aware (not every configured provider/API style supports an
equivalent tool — this would need per-provider capability flags in
`ai-router.json`, not a blanket assumption), (b) passes through a
max-searches limit consistently, and (c) surfaces web-search usage/cost in
the router's meta-file the same way `weekly-quality-control.yml` already
reports it (`web_search=$ACTUAL_COUNT` in its own usage marker). That is a
real feature addition to the router itself, not a per-workflow migration,
and is out of scope for this pass.

**Until then:** `weekly-quality-control.yml` stays on direct Anthropic
calls, unchanged, with its web-search capability fully intact.
