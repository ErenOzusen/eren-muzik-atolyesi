#!/usr/bin/env python3
"""Opt-in GET-only voice/quota check. Contains no generation endpoint."""
import argparse
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from faceless_scene_plan_contract import validate_quality_config


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get_metadata(path, api_key):
    request = urllib.request.Request("https://api.elevenlabs.io" + path,
                                     headers={"xi-api-key": api_key, "Accept": "application/json"},
                                     method="GET")
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        # Log only documented identifiers, never provider message/raw payload.
        safe_codes = {"invalid_api_key", "missing_permissions", "voice_not_found",
                      "quota_exceeded", "authentication_error", "authorization_error",
                      "invalid_request", "invalid_voice_id", "permission_denied"}
        code = "unclassified"
        try:
            error = json.load(exc)
            detail = error.get("detail", {})
            candidate = detail.get("status") if isinstance(detail, dict) else None
            if candidate is None and isinstance(error.get("error"), dict):
                candidate = error["error"].get("code")
            if candidate in safe_codes and candidate != api_key:
                code = candidate
        except (ValueError, TypeError, AttributeError):
            pass
        endpoint = "selected_voice" if path.startswith("/v1/voices/") else "subscription"
        raise ValueError(f"{endpoint} metadata access failed: HTTP {exc.code}; provider_code={code}") from None
    except (urllib.error.URLError, OSError, ValueError):
        raise ValueError("metadata access failed; no generation attempted") from None
    if not isinstance(payload, dict):
        raise ValueError("metadata object required")
    return payload


def check_readiness(config, *, live_metadata=False, api_key=""):
    validate_quality_config(config)
    final = config["tts"]["final"]
    voice_id = final.get("voice_id")
    if not isinstance(voice_id, str) or not re.fullmatch(r"[A-Za-z0-9]{20}", voice_id):
        raise ValueError("configured voice ID invalid")
    if final.get("secret_name") != "ELEVENLABS_API_KEY":
        raise ValueError("expected ElevenLabs secret name required")
    result = {"voice_id": voice_id, "live_metadata_checked": False,
              "generation_attempted": False, "ready_for_paid_generation": False,
              "tts_permission_verified": False, "publication_allowed": False}
    if live_metadata is not True:
        return result
    if not isinstance(api_key, str) or not api_key.strip():
        raise ValueError("ELEVENLABS_API_KEY missing")
    voice = get_metadata("/v1/voices/" + voice_id, api_key)
    if voice.get("voice_id") != voice_id:
        raise ValueError("voice metadata does not match selected ID")
    subscription = get_metadata("/v1/user/subscription", api_key)
    used, limit = subscription.get("character_count"), subscription.get("character_limit")
    if type(used) is not int or type(limit) is not int or min(used, limit) < 0:
        raise ValueError("valid subscription quota counts required")
    result.update({"live_metadata_checked": True, "voice_access_verified": True,
                   "subscription_remaining_credits": max(0, limit - used),
                   "api_key_credit_cap_verified": False})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--read-live-metadata", action="store_true")
    args = parser.parse_args()
    try:
        result = check_readiness(json.loads(args.config.read_text()),
                                 live_metadata=args.read_live_metadata,
                                 api_key=os.getenv("ELEVENLABS_API_KEY", ""))
    except ValueError as exc:
        parser.exit(1, f"readiness blocked: {exc}\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
