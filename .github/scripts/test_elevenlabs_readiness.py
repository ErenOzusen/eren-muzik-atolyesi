import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from elevenlabs_readiness import check_readiness, get_metadata
from test_faceless_scene_plan_contract import load_config


VOICE = "tILIOdKERNNbBHVEXk7I"


class ReadinessTests(unittest.TestCase):
    @patch("elevenlabs_readiness.urllib.request.build_opener")
    def test_error_only_reports_documented_code_not_secret_or_raw_message(self, opener):
        for code in ("voice_not_found", "synthetic-key"):
            payload = json.dumps({"detail": {"status": code, "message": "sensitive synthetic-key"}}).encode()
            opener.return_value.open.side_effect = urllib.error.HTTPError(
                "https://api.elevenlabs.io/v1/voices/" + VOICE, 400, "Bad request", {}, io.BytesIO(payload))
            with self.assertRaises(ValueError) as caught:
                get_metadata("/v1/voices/" + VOICE, "synthetic-key")
            message = str(caught.exception)
            self.assertIn("selected_voice", message)
            self.assertIn("voice_not_found" if code == "voice_not_found" else "unclassified", message)
            self.assertNotIn("synthetic-key", message)
            self.assertNotIn("sensitive", message)

    @patch("elevenlabs_readiness.get_metadata")
    def test_default_makes_no_requests_even_with_a_key(self, get):
        result = check_readiness(load_config(), api_key="synthetic-key")
        get.assert_not_called()
        self.assertFalse(result["generation_attempted"])

    @patch("elevenlabs_readiness.get_metadata")
    def test_only_selected_voice_and_subscription_are_requested(self, get):
        get.side_effect = [{"voice_id": VOICE}, {"character_count": 500, "character_limit": 2000}]
        result = check_readiness(load_config(), live_metadata=True, api_key="synthetic-key")
        self.assertEqual([c.args[0] for c in get.call_args_list], ["/v1/voices/" + VOICE, "/v1/user/subscription"])
        self.assertEqual(result["subscription_remaining_credits"], 1500)
        self.assertFalse(result["ready_for_paid_generation"])
        self.assertFalse(result["tts_permission_verified"])
        self.assertNotIn("synthetic-key", str(result))

    @patch("elevenlabs_readiness.get_metadata")
    def test_missing_key_or_invalid_voice_blocks_before_requests(self, get):
        for config, key in [(load_config(), ""), (load_config(), "key")]:
            if key:
                config["tts"]["final"]["voice_id"] = "../../other"
            with self.assertRaises(ValueError):
                check_readiness(config, live_metadata=True, api_key=key)
        get.assert_not_called()

    @patch("elevenlabs_readiness.get_metadata")
    def test_voice_mismatch_and_bad_quota_are_rejected(self, get):
        for replies in [[{"voice_id": "other"}],
                        [{"voice_id": VOICE}, {"character_count": True, "character_limit": 10}],
                        [{"voice_id": VOICE}, {"character_count": 0}]]:
            get.side_effect = replies
            with self.assertRaises(ValueError):
                check_readiness(load_config(), live_metadata=True, api_key="synthetic-key")


if __name__ == "__main__":
    unittest.main()
