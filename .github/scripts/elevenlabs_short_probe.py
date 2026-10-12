#!/usr/bin/env python3
"""One-shot, explicitly authorized ElevenLabs short-voice probe."""
import argparse
import base64
import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / ".github/quality/issue-100-scenario-1-script.txt"
CONFIG_PATH = ROOT / ".github/config/faceless-quality-v2.json"
SENTENCE = "Gitara yeni başlıyorsan üç küçük alışkanlık işini kolaylaştırır."
VOICE_ID = "tILIOdKERNNbBHVEXk7I"
MODEL_ID = "eleven_multilingual_v2"
MAX_CHARS = 64


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_inputs(script_text, config, script_sha256):
    actual_sha = hashlib.sha256(script_text.encode("utf-8")).hexdigest()
    if not isinstance(script_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", script_sha256) or actual_sha != script_sha256:
        raise ValueError("selected script SHA-256 mismatch")
    if len(SENTENCE) > MAX_CHARS or not script_text.startswith(SENTENCE):
        raise ValueError("approved probe sentence does not match the selected script")
    try:
        final = config["tts"]["final"]
    except (TypeError, KeyError):
        raise ValueError("ElevenLabs final voice configuration missing") from None
    if final.get("voice_id") != VOICE_ID or final.get("provider") != "elevenlabs":
        raise ValueError("configured voice does not match approved probe voice")
    return actual_sha


def _request_once(api_key, opener=None):
    url = ("https://api.elevenlabs.io/v1/text-to-speech/" +
           urllib.parse.quote(VOICE_ID, safe="") +
           "/with-timestamps?output_format=mp3_44100_128")
    body = json.dumps({"text": SENTENCE, "model_id": MODEL_ID}).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "xi-api-key": api_key, "Accept": "application/json",
        "Content-Type": "application/json"})
    try:
        with (opener or urllib.request.build_opener(NoRedirect)).open(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise ValueError(f"generation failed: HTTP {exc.code}; no retry attempted") from None
    except (urllib.error.URLError, OSError, ValueError):
        raise ValueError("generation failed; no retry attempted") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("audio_base64"), str):
        raise ValueError("provider response missing audio payload")
    try:
        audio = base64.b64decode(payload["audio_base64"], validate=True)
    except (ValueError, TypeError):
        raise ValueError("provider response audio payload invalid") from None
    if not audio:
        raise ValueError("provider response audio payload empty")
    alignment = payload.get("alignment") or payload.get("normalized_alignment")
    if not isinstance(alignment, dict):
        raise ValueError("provider response alignment missing")
    return audio, alignment


def run(*, generate=False, owner_approved=False, expected_credits=None,
        voice_multiplier=None, approved_max_credits=None, api_key="",
        script_text=None, config=None, script_sha256=None, out_dir=Path("."), opener=None):
    script_text = SCRIPT_PATH.read_text(encoding="utf-8").strip() if script_text is None else script_text
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if config is None else config
    actual_sha = hashlib.sha256(script_text.encode("utf-8")).hexdigest()
    if generate and script_sha256 is None:
        raise ValueError("selected script SHA-256 confirmation required")
    validate_inputs(script_text, config, script_sha256 or actual_sha)
    if not generate:
        return {"dry_run": True, "generation_attempted": False, "voice_id": VOICE_ID,
                "model_id": MODEL_ID, "characters": len(SENTENCE), "base_credit_estimate": len(SENTENCE)}
    if owner_approved is not True:
        raise ValueError("explicit owner approval required")
    if not all(type(x) in (int, float) and math.isfinite(x) for x in
               (expected_credits, voice_multiplier, approved_max_credits)):
        raise ValueError("numeric credit estimate, voice multiplier, and approved maximum required")
    if voice_multiplier < 1 or expected_credits < 0 or approved_max_credits < 0:
        raise ValueError("voice multiplier and credit values out of range")
    if expected_credits < math.ceil(len(SENTENCE) * voice_multiplier):
        raise ValueError("expected credits below declared multiplier estimate")
    if expected_credits > approved_max_credits:
        raise ValueError("expected credits exceed approved maximum")
    if not isinstance(api_key, str) or not api_key.strip():
        raise ValueError("ELEVENLABS_API_KEY missing")
    if os.getenv("GITHUB_RUN_ATTEMPT", "1") != "1":
        raise ValueError("re-running paid generation is forbidden; review the original output")
    out_dir = Path(out_dir)
    if any((out_dir / name).exists() for name in
           ("elevenlabs-short-probe.mp3", "elevenlabs-short-probe-alignment.json")):
        raise ValueError("existing test output found; refusing another paid request")
    audio, alignment = _request_once(api_key, opener=opener)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "elevenlabs-short-probe.mp3").write_bytes(audio)
    (out_dir / "elevenlabs-short-probe-alignment.json").write_text(
        json.dumps(alignment, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"dry_run": False, "generation_attempted": True, "voice_id": VOICE_ID,
            "characters": len(SENTENCE), "script_sha256": actual_sha,
            "audio_file": "elevenlabs-short-probe.mp3",
            "alignment_file": "elevenlabs-short-probe-alignment.json"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate", action="store_true", help="perform one paid POST")
    parser.add_argument("--owner-approved", action="store_true")
    parser.add_argument("--expected-credits", type=float)
    parser.add_argument("--voice-multiplier", type=float)
    parser.add_argument("--approved-max-credits", type=float)
    parser.add_argument("--script-sha256")
    parser.add_argument("--out-dir", type=Path, default=Path("."))
    args = parser.parse_args()
    try:
        result = run(generate=args.generate, owner_approved=args.owner_approved,
                     expected_credits=args.expected_credits, voice_multiplier=args.voice_multiplier,
                     approved_max_credits=args.approved_max_credits,
                     api_key=os.getenv("ELEVENLABS_API_KEY", ""), script_sha256=args.script_sha256,
                     out_dir=args.out_dir)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        parser.exit(1, f"short probe blocked: {exc}\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
