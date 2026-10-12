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
