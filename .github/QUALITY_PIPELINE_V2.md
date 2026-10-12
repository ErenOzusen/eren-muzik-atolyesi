# Quality Pipeline V2 — implementation checkpoint

Local implementation checkpoint: 12 October 2026. This is a reviewable code
change; it does not enable generation, deploy a worker, or publish a video.

## Task model routing

The router accepts `routing.models_by_output`, keyed by the exact output file
basename. Each provider binding may specify a task-specific `model_env` and an
optional `default_model`. Workflow job environments expose repository variables:

| Task | Output | Variable prefix |
| --- | --- | --- |
| Research | weekly-report-raw.md | RESEARCH |
| Script | scripts-raw.txt | SCRIPT |
| Content QC | raw-report.md | QC |
| Correction | final-scripts.md | CORRECTION |
| Final check | final-check.md | FINAL_CHECK |
| Filming | filming-package.md | FILMING |
| Editing | editing-package.md | EDITING |
| Scene plan (future adapter) | scene-plan.json | SCENE_PLAN |

Variables follow `<PREFIX>_<PROVIDER>_MODEL`, for example
`SCRIPT_ANTHROPIC_MODEL` and `EDITING_OPENAI_MODEL`. Providers are `ANTHROPIC`,
`OPENAI`, `DEEPSEEK`, and `QWEN`. Unset task variables preserve existing model
selection. Credentials and provider ordering still use the existing routing
settings; model bindings alone do not select a different provider.

Budget-controlled runs pin the provider and model authorized by the existing
budget config, ahead of task/global model overrides and provider fallback. The
historical real-AI and filming budgets retain their original model and limits.
No new model prices, API credentials, or live repository variables were set by
this change. Cost savings require selecting and pricing appropriate task models
before a live run; this code change alone does not establish a savings amount.

## Reviewed scene plan

Draft plans remain valid with no assets, no final timings, and `render_ready:false`.
For `render_ready:true`, each scene needs reviewed asset IDs and `semantic_qc`
entries containing `asset_id`, `approved:true`, a finite score meeting the
configured threshold, `observed_must_show`, and `absent_must_not_show`. Those
lists must cover the scene's visual constraints.

`owner_editorial_approval` carries `approved:true`, `script_sha256`, and
`scene_plan_sha256`. The plan fingerprint covers all content except the approval
object itself. A script, asset, timing, or review change invalidates that approval.
The validator checks supplied evidence; it does not inspect pixels or authenticate
the owner. Evidence must come from actual visual review and the existing
authenticated approval gate before production use.

## Final audio timeline contract

`faceless_audio_timeline_contract.py` accepts a reviewed scene plan, script,
quality config, local audio file, and normalized scene-level alignment. Alignment
uses schema version 1 and event `faceless_final_tts_alignment_v2` with provider
`elevenlabs`, script/audio SHA-256 fingerprints, positive `duration_seconds`, and
one `segments` entry per scene. Each segment carries `scene_id`, `narration`,
`start_seconds`, and `end_seconds`.

It checks exact narration/order, audio-byte fingerprint, scene timing equality,
and contiguous coverage from zero through the declared duration. Output carries
both fingerprints and the validated scene timeline. Audio duration must be
independently measured by the future adapter; this module does not transcribe
audio or verify its acoustic content. Synthetic test bytes are not a real MP3.

The new timeline tests run in the existing worker's contract-test job. The live
worker remains the existing Edge/Pexels implementation; it does not consume this
new timeline yet. ElevenLabs stays disabled, and the contract explicitly returns
`render_dispatch_allowed:false` and `publication_allowed:false`.

## Next production integration

Still needed: real clip review, an ElevenLabs adapter with measured duration and
normalized alignment, an audio-timed renderer/subtitle adapter, and end-to-end
review of one reference video. Paid API use and publication need their existing
separate owner and budget approvals. A passing structural contract is not a
claim that a generated video has passed visual or acoustic quality review.

## Validation for this change

- 56 faceless tests and the Issue #100 scene-plan fixture test passed.
- 30 router tests passed, including task overrides and budget precedence.
- 49 router/cost-guard, preflight-budget, ledger, and filming-budget tests passed.
- Eight JavaScript migration/integration scripts passed.
- Workflow YAML parsing, all 28 task-model environment bindings, and
  `git diff --check` passed.

All generation/provider responses in these checks are mocked; no paid generation
or publication was run. Frontend lint/build were not run because no frontend or
backend files changed. GitHub CI has not run these local changes yet.

## Follow-up: allocation and local rendering preparation

The initial PR #113 passed GitHub checks, including automation, worker contracts,
router smoke test, frontend, backend, repository safety and CodeQL. Its live-worker
job was skipped. The following additions extend preparation; PR #113 remains draft.

### Proposed task allocation

`.github/config/faceless-quality-model-plan.json` stores an **inactive proposal**.
It is not loaded by the live router, does not modify repository variables, and
does not authorize spending. Official prices were checked on 12 October 2026:

| Text task | Model | Input/output limit | Estimated maximum for one request |
| --- | --- | --- | --- |
| Scene planning | claude-haiku-5-5 | 2,000 / 2,000 | $0.00120 |
| Editing plan | claude-haiku-5-5 | 1,500 / 1,200 | $0.00075 |
| Editorial text QC | claude-sonnet-4-6 | 3,000 / 1,200 | $0.02700 |

Total hypothetical text-only estimate: **$0.02895**, with a proposed $0.03 budget
and one attempt per task. It excludes voice credits, image tokens, tools/search,
retries and tax; it is not a total-video quote or a runtime-enforced ledger.
Haiku prices apply to these prompts below 100K input tokens. The existing
historical budgets and model pins remain intact. For the current Issue #100
reference, reuse its approved script and existing scene plan first: no new text
model request is needed merely to compile alignment, subtitles or render commands.

Source prices: [Anthropic Haiku](https://www.anthropic.com/claude/haiku) and
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

### ElevenLabs saved-response adapter

`faceless_elevenlabs_alignment.py` accepts saved `/with-timestamps` response
JSON and local audio bytes, plus an independently measured duration. It validates
original character alignment (or normalized alignment only if original is absent),
exact script text except whitespace, finite ordered timestamps, and optional
base64 audio identity. Number/text expansions that change the script fail closed.
Scene cuts bisect inter-scene silence and span the measured audio duration.

It returns `alignment` and `updated_plan`. The updated plan stores proposed
timing in `pending_final_tts_alignment`, removes editorial approval and restores
draft status. It never generates speech, obtains credentials, or approves clips.
API shape source: [ElevenLabs timing API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).

### Reviewed local render planning

`faceless_reviewed_render_plan.prepare_render` consumes a fully reviewed plan,
normalized alignment, local narration and one explicit local clip binding per
scene. It reads local bytes and probes streams/durations with FFprobe. Each
binding includes `scene_id`, `asset_id`, `path`, `sha256`, and optional
`trim_start_seconds`. The selected file's SHA must also appear as `asset_sha256`
in that asset's fingerprint-bound semantic review. A substituted, missing,
unreviewed, or too-short clip blocks preparation; it never loops or substitutes.

The returned object contains FFmpeg argument arrays and `subtitle_text` for
`final-captions.srt`. Write those captions into an isolated working directory
before running the prepared command there. FFmpeg produces `final-video.mp4`
without overwriting existing files, using only selected footage and narration,
1080×1920 video and burned scene captions. Scaling preserves full source frames
and pads narrower material; actual composition still needs visual review.
The preparation function does not execute the command or wire the live worker.

A real, local FFmpeg regression test renders four seconds of synthetic blue
footage and silent audio in a temporary directory and verifies dimensions,
duration and audio stream. This is test media, not a quality reference video.

### Actual reference-video inputs still required

Issue #100 recorded six approved candidate IDs:
`7574545,6670728,7508179,8472212,4706206,8103317`.
These candidate-list approvals are not per-scene semantic evidence. No mapping
was invented when public clip pages could not be retrieved in this session.

| Scene | Actual visual review must confirm |
| --- | --- |
| 1 | Guitar practice preparation, hands and calm workspace |
| 2 | Tuner visible and a string actually being tuned |
| 3 | Fretting fingers changing between chords |
| 4 | Guitar practice being recorded on a phone/recorder |
| 5 | Slow, controlled picking or fretting close-up |
| 6 | Focused guitar practice |

ElevenLabs API key, voice ID, API quota and audio credit estimate have not been
verified. No provider key is available in the local process. Credentials should
be stored in GitHub Secrets, never source files or chat. A subscription alone
does not confirm available API credits. Actual paid speech still requires the
existing owner/budget approvals, and authenticated clip review must bind the
reviewed local file hashes before a production render.

Follow-up local verification: 73 faceless tests and the Issue #100 fixture test
passed, including 13 ElevenLabs adapter tests and four render-planning tests
(one with real FFmpeg on synthetic media). Model-proposal arithmetic, workflow
YAML syntax and `git diff --check` passed. No actual reference clip, voice API,
provider generation or publication was used in these tests.

## Selected voice and GET-only readiness

The owner selected **Hasan Yasin – Warm Turkish Narrator** and supplied voice ID
`tILIOdKERNNbBHVEXk7I`. It is now recorded in the existing final-TTS config;
final speech generation remains disabled. The owner reports adding
`ELEVENLABS_API_KEY` to GitHub repository secrets. The key's validity, permissions,
and actual credit cap have not yet been verified by a live request.

`ElevenLabs Read-Only Readiness` is a manual workflow with `read_live_metadata`
defaulting to false. Pull requests only run mocked offline tests. If an owner
explicitly dispatches the metadata check, it makes two GET requests: the selected
voice and `/v1/user/subscription`. No text, audio, or generation request is sent.
Redirects are disabled; credentials and raw error payloads are not printed.
Output contains only selected voice ID, remaining subscription quota, and
readiness flags. It does not claim that TTS permission or the API key's separate
credit ceiling has been verified, and never authorizes paid generation.

Sources: [voice metadata](https://elevenlabs.io/docs/api-reference/voices/get),
[subscription metadata](https://elevenlabs.io/docs/api-reference/user/subscription/get).
Four new mocked readiness tests plus 19 scene and one Issue #100 test passed.
Workflow YAML syntax and diff checks passed. No live metadata check was run.
