import base64
import hashlib
import io
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.request import Request

import elevenlabs_short_probe as probe


SCRIPT = probe.SENTENCE + " Daha fazla seçili senaryo metni."
CONFIG = {"tts": {"final": {"voice_id": probe.VOICE_ID, "provider": "elevenlabs"}}}
SHA = hashlib.sha256(SCRIPT.encode("utf-8")).hexdigest()


class Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class Opener:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return Response(self.payload)


class ShortProbeTests(unittest.TestCase):
    def test_real_draft_uses_existing_approved_trimmed_script_fingerprint(self):
        plan = json.loads((probe.ROOT / '.github/quality/issue-100-scenario-1-scene-plan.json').read_text())
        result = probe.run(script_sha256=plan['script_sha256'])
        self.assertFalse(result['generation_attempted'])

    def test_underpriced_quote_and_rerun_are_blocked_before_post(self):
        opener = Opener({})
        common = dict(generate=True, owner_approved=True, expected_credits=64,
                      voice_multiplier=1, approved_max_credits=100, api_key="secret",
                      script_text=SCRIPT, config=CONFIG, script_sha256=SHA, opener=opener)
        with self.assertRaisesRegex(ValueError, "below declared"):
            probe.run(**{**common, "expected_credits": 0})
        with self.assertRaisesRegex(ValueError, "below declared"):
            probe.run(**{**common, "voice_multiplier": 2})
        with patch.dict("os.environ", {"GITHUB_RUN_ATTEMPT": "2"}):
            with self.assertRaisesRegex(ValueError, "re-running"):
                probe.run(**common)
        self.assertEqual([], opener.requests)

    def test_existing_output_blocks_another_paid_request(self):
        opener = Opener({})
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "elevenlabs-short-probe.mp3").write_bytes(b"existing")
            with self.assertRaisesRegex(ValueError, "existing test output"):
                probe.run(generate=True, owner_approved=True, expected_credits=64,
                          voice_multiplier=1, approved_max_credits=100, api_key="secret",
                          script_text=SCRIPT, config=CONFIG, script_sha256=SHA,
                          opener=opener, out_dir=Path(directory))
        self.assertEqual([], opener.requests)

    def test_dry_run_is_safe_and_bounded(self):
        opener = Opener({})
        result = probe.run(script_text=SCRIPT, config=CONFIG, opener=opener)
        self.assertFalse(result["generation_attempted"])
        self.assertEqual(64, result["characters"])
        self.assertEqual([], opener.requests)

    def test_bad_sentence_or_sha_blocks_before_request(self):
        opener = Opener({})
        with self.assertRaisesRegex(ValueError, "sentence"):
            probe.run(generate=True, owner_approved=True, expected_credits=64,
                      voice_multiplier=1, approved_max_credits=64, api_key="secret",
                      script_text="Different opening sentence.", config=CONFIG,
                      script_sha256=hashlib.sha256(b"Different opening sentence.").hexdigest(), opener=opener)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            probe.run(generate=True, owner_approved=True, expected_credits=64,
                      voice_multiplier=1, approved_max_credits=64, api_key="secret",
                      script_text=SCRIPT, config=CONFIG, script_sha256="0" * 64, opener=opener)
        self.assertEqual([], opener.requests)

    def test_missing_owner_or_budget_blocks_before_request(self):
        opener = Opener({})
        common = dict(generate=True, expected_credits=64, voice_multiplier=1,
                      approved_max_credits=64, api_key="secret", script_text=SCRIPT,
                      config=CONFIG, script_sha256=SHA, opener=opener)
        with self.assertRaisesRegex(ValueError, "owner approval"):
            probe.run(**common)
        with self.assertRaisesRegex(ValueError, "exceed approved"):
            probe.run(**{**common, "owner_approved": True, "approved_max_credits": 63})
        with self.assertRaisesRegex(ValueError, "multiplier"):
            probe.run(**{**common, "owner_approved": True, "voice_multiplier": 0.5})
        self.assertEqual([], opener.requests)

    def test_live_sends_exactly_one_bounded_post_and_saves_outputs(self):
        opener = Opener({"audio_base64": base64.b64encode(b"mp3").decode(),
                         "alignment": {"characters": ["G"], "character_start_times_seconds": [0]}})
        with tempfile.TemporaryDirectory() as directory:
            result = probe.run(generate=True, owner_approved=True, expected_credits=64,
                               voice_multiplier=1, approved_max_credits=64, api_key="secret",
                               script_text=SCRIPT, config=CONFIG, script_sha256=SHA,
                               out_dir=Path(directory), opener=opener)
            self.assertTrue(result["generation_attempted"])
            self.assertEqual(1, len(opener.requests))
            req, timeout = opener.requests[0]
            self.assertEqual("POST", req.get_method())
            self.assertIn("with-timestamps?output_format=mp3_44100_128", req.full_url)
            body = json.loads(req.data)
            self.assertEqual(probe.SENTENCE, body["text"])
            self.assertEqual(probe.MODEL_ID, body["model_id"])
            self.assertNotIn("language_code", body)
            self.assertEqual(30, timeout)
            self.assertEqual(b"mp3", (Path(directory) / "elevenlabs-short-probe.mp3").read_bytes())
            self.assertTrue((Path(directory) / "elevenlabs-short-probe-alignment.json").exists())


if __name__ == "__main__":
    unittest.main()
