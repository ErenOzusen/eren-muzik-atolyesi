#!/usr/bin/env python3
"""Fail-closed contract for Quality Pipeline V2 scene plans.

This module is deliberately network-free. It validates that every narration
segment has an explicit visual intent and that a render-ready plan cannot fall
back to a generic sequential stock montage.

The live Edge/Pexels worker is not modified by this module. ElevenLabs and
publication remain disabled elsewhere until separate owner approval.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


class ScenePlanError(ValueError):
    pass


SPACE_RE = re.compile(r"\s+")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def normalize_text(value: str) -> str:
    return SPACE_RE.sub(" ", str(value).strip())


def script_sha256(script_text: str) -> str:
    return hashlib.sha256(script_text.encode("utf-8")).hexdigest()


def _require_nonempty_list(scene: dict, key: str, *, max_items: int) -> list[str]:
    value = scene.get(key)
    if not isinstance(value, list) or not value:
        raise ScenePlanError(f"{key} boş olmayan liste olmalı")
    items = [normalize_text(item) for item in value if normalize_text(item)]
    if len(items) != len(value) or len(items) > max_items:
        raise ScenePlanError(f"{key} 1-{max_items} temiz öğe içermeli")
    return items


def _require_forbidden_list(scene: dict) -> list[str]:
    value = scene.get("must_not_show", [])
    if not isinstance(value, list):
        raise ScenePlanError("must_not_show liste olmalı")
    items = [normalize_text(item) for item in value if normalize_text(item)]
    if len(items) != len(value) or len(items) > 8:
        raise ScenePlanError("must_not_show en fazla 8 temiz öğe içermeli")
    return items


def validate_quality_config(config: dict) -> None:
    if config.get("schema_version") != 1:
        raise ScenePlanError("quality config schema_version 1 olmalı")
    planner = config.get("scene_planner")
    if not isinstance(planner, dict) or planner.get("required") is not True:
        raise ScenePlanError("scene_planner zorunlu olmalı")
    if planner.get("require_sentence_scene_alignment") is not True:
        raise ScenePlanError("cümle-sahne eşleme zorunlu olmalı")
    if planner.get("require_asset_per_scene_before_render") is not True:
        raise ScenePlanError("render öncesi her sahneye asset zorunlu olmalı")
    if planner.get("require_semantic_qc") is not True:
        raise ScenePlanError("semantic QC zorunlu olmalı")
    if planner.get("require_owner_editorial_approval") is not True:
        raise ScenePlanError("owner editoryal onayı zorunlu olmalı")

    render = config.get("render")
    if not isinstance(render, dict):
        raise ScenePlanError("render config eksik")
    if render.get("aspect_ratio") != "9:16":
        raise ScenePlanError("ilk V2 hattı 9:16 olmalı")
    if render.get("timing_source") != "final_tts_alignment":
        raise ScenePlanError("zamanlama final TTS alignment kaynağından gelmeli")
    if render.get("sequential_stock_concat_forbidden") is not True:
        raise ScenePlanError("generic sequential stock concat yasak olmalı")
    if render.get("subtitle_sync_required") is not True:
        raise ScenePlanError("altyazı senkronu zorunlu olmalı")

    tts = config.get("tts")
    if not isinstance(tts, dict):
        raise ScenePlanError("tts config eksik")
    draft = tts.get("draft", {})
    final = tts.get("final", {})
    if draft.get("provider") != "edge" or draft.get("enabled") is not True:
        raise ScenePlanError("taslak TTS Edge ve açık olmalı")
    if final.get("provider") != "elevenlabs":
        raise ScenePlanError("final TTS sağlayıcısı ElevenLabs olarak hazırlanmalı")
    if final.get("enabled") is not False:
        raise ScenePlanError("ElevenLabs final TTS bu temel PR'da kapalı kalmalı")
    if not str(final.get("secret_name", "")).strip():
        raise ScenePlanError("ElevenLabs secret adı zorunlu")
    if final.get("requires_owner_approval") is not True:
        raise ScenePlanError("final TTS owner onayı istemeli")
    if final.get("requires_budget_approval") is not True:
        raise ScenePlanError("final TTS bütçe onayı istemeli")

    publication = config.get("publication")
    if not isinstance(publication, dict):
        raise ScenePlanError("publication config eksik")
    if publication.get("instagram_enabled") is not False:
        raise ScenePlanError("Instagram yayını bu temel PR'da kapalı kalmalı")
    if publication.get("youtube_enabled") is not False:
        raise ScenePlanError("YouTube yayını bu temel PR'da kapalı kalmalı")
    if publication.get("require_owner_publish_approval") is not True:
        raise ScenePlanError("yayın owner onayı zorunlu olmalı")


def evaluate(plan: dict, script_text: str, config: dict) -> dict:
    validate_quality_config(config)

    if plan.get("schema_version") != 1:
        raise ScenePlanError("scene plan schema_version 1 olmalı")
    if plan.get("event") != "faceless_scene_plan_v2":
        raise ScenePlanError("geçersiz scene plan event")
    expected_sha = script_sha256(script_text)
    supplied_sha = str(plan.get("script_sha256", "")).strip().lower()
    if not SHA256_RE.fullmatch(supplied_sha) or supplied_sha != expected_sha:
        raise ScenePlanError("scene plan script SHA seçili senaryoyla eşleşmiyor")
    if plan.get("aspect_ratio") != "9:16":
        raise ScenePlanError("scene plan aspect_ratio 9:16 olmalı")

    planner = config["scene_planner"]
    scenes = plan.get("scenes")
    if not isinstance(scenes, list):
        raise ScenePlanError("scenes liste olmalı")
    min_scenes = int(planner.get("min_scenes", 3))
    max_scenes = int(planner.get("max_scenes", 10))
    if not min_scenes <= len(scenes) <= max_scenes:
        raise ScenePlanError(f"scene sayısı {min_scenes}-{max_scenes} arasında olmalı")

    purposes = {"hook", "value", "proof", "transition", "cta"}
    narration_parts: list[str] = []
    render_ready = bool(plan.get("render_ready", False))
    previous_end = 0.0

    normalized_scenes = []
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            raise ScenePlanError("her scene object olmalı")
        if scene.get("scene_id") != index:
            raise ScenePlanError("scene_id 1'den başlayan sıralı integer olmalı")

        narration = normalize_text(scene.get("narration", ""))
        if not narration:
            raise ScenePlanError("her scene narration içermeli")
        narration_parts.append(narration)

        purpose = str(scene.get("purpose", "")).strip()
        if purpose not in purposes:
            raise ScenePlanError("scene purpose geçersiz")

        visual_queries = _require_nonempty_list(scene, "visual_queries", max_items=4)
        must_show = _require_nonempty_list(scene, "must_show", max_items=5)
        must_not_show = _require_forbidden_list(scene)

        duration = scene.get("target_duration_seconds")
        if not isinstance(duration, (int, float)) or isinstance(duration, bool):
            raise ScenePlanError("target_duration_seconds sayı olmalı")
        if not 1.0 <= float(duration) <= float(planner.get("max_scene_seconds", 5.0)):
            raise ScenePlanError("scene hedef süresi kalite sınırının dışında")

        asset_ids = scene.get("approved_asset_ids", [])
        if not isinstance(asset_ids, list):
            raise ScenePlanError("approved_asset_ids liste olmalı")
        clean_asset_ids = [str(item).strip() for item in asset_ids if str(item).strip()]
        if len(clean_asset_ids) != len(asset_ids) or len(clean_asset_ids) > 3:
            raise ScenePlanError("approved_asset_ids en fazla 3 temiz id içermeli")

        timing = scene.get("timing")
        if render_ready:
            if not clean_asset_ids:
                raise ScenePlanError("render-ready planda her sahnenin onaylı asset'i olmalı")
            if not isinstance(timing, dict):
                raise ScenePlanError("render-ready planda timing zorunlu")
            start = timing.get("start_seconds")
            end = timing.get("end_seconds")
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                raise ScenePlanError("timing start/end sayı olmalı")
            start = float(start)
            end = float(end)
            if start < 0 or end <= start:
                raise ScenePlanError("timing aralığı geçersiz")
            if start + 0.05 < previous_end:
                raise ScenePlanError("scene timing geriye binemez")
            previous_end = end
        elif timing not in (None, {}):
            raise ScenePlanError("taslak scene planda timing boş olmalı; final TTS sonrası yazılır")

        normalized_scenes.append(
            {
                "scene_id": index,
                "purpose": purpose,
                "narration": narration,
                "visual_queries": visual_queries,
                "must_show": must_show,
                "must_not_show": must_not_show,
                "approved_asset_ids": clean_asset_ids,
                "target_duration_seconds": float(duration),
            }
        )

    reconstructed = normalize_text(" ".join(narration_parts))
    if reconstructed != normalize_text(script_text):
        raise ScenePlanError("scene narration parçaları seçili senaryoyu eksiksiz ve sıralı kapsamıyor")

    if render_ready and plan.get("timing_source") != "final_tts_alignment":
        raise ScenePlanError("render-ready plan final_tts_alignment kullanmalı")
    if not render_ready and plan.get("timing_source") not in (None, "pending_final_tts"):
        raise ScenePlanError("taslak plan timing_source pending_final_tts olmalı")

    return {
        "schema_version": 1,
        "event": "faceless_scene_plan_v2_contract",
        "script_sha256": expected_sha,
        "scene_count": len(normalized_scenes),
        "render_ready": render_ready,
        "semantic_qc_required": True,
        "owner_editorial_approval_required": True,
        "sequential_stock_concat_allowed": False,
        "timing_source": "final_tts_alignment" if render_ready else "pending_final_tts",
        "publication_allowed": False,
        "scenes": normalized_scenes,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--script", required=True)
    parser.add_argument("--quality-config", required=True)
    parser.add_argument("--output-file", required=True)
    args = parser.parse_args()

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    script_text = Path(args.script).read_text(encoding="utf-8").strip()
    config = json.loads(Path(args.quality_config).read_text(encoding="utf-8"))
    result = evaluate(plan, script_text, config)
    Path(args.output_file).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
