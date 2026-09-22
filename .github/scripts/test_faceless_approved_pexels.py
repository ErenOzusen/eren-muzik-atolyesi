#!/usr/bin/env python3
from __future__ import annotations

import unittest

from faceless_approved_pexels import (
    MediaApprovalError, approval_line, parse_ids, select_rendition,
    validate_approval,
)


SHA = "a" * 64
IDS = ["7574545", "6670728", "7722398", "4706206", "8927987", "6377571"]


class ApprovedPexelsTests(unittest.TestCase):
    def test_exact_owner_comment_binds_issue_scenario_script_and_ids(self):
        body = approval_line(100, "1", SHA, IDS)
        comments = [{"author": {"login": "ErenOzusen"}, "body": body}]
        self.assertEqual(len(validate_approval(comments, "ErenOzusen", 100, "1", SHA, IDS)), 64)
        for issue, scenario, sha, ids in (
            (101, "1", SHA, IDS), (100, "2", SHA, IDS),
            (100, "1", "b" * 64, IDS), (100, "1", SHA, list(reversed(IDS))),
        ):
            with self.subTest(issue=issue, scenario=scenario, ids=ids):
                with self.assertRaises(MediaApprovalError):
                    validate_approval(comments, "ErenOzusen", issue, scenario, sha, ids)
        with self.assertRaises(MediaApprovalError):
            validate_approval([{"author": {"login": "other"}, "body": body}],
                              "ErenOzusen", 100, "1", SHA, IDS)

    def test_invalid_ids_fail_closed(self):
        for raw in ("1,2", "1,1,2,3,4,5", "1,2,abc,4,5,6", "1,2,3,4,5,6,7,8,9", "1,2,3,4,5,6,"):
            with self.subTest(raw=raw), self.assertRaises(MediaApprovalError):
                parse_ids(raw)

    def test_only_exact_pexels_portrait_rendition_allowed(self):
        valid = {
            "id": 7574545,
            "url": "https://www.pexels.com/video/a-person-tuning-7574545/",
            "duration": 10,
            "video_files": [
                {"width": 1920, "height": 1080, "file_type": "video/mp4",
                 "link": "https://videos.pexels.com/video-files/7574545/wide.mp4"},
                {"width": 1080, "height": 1920, "file_type": "video/mp4",
                 "link": "https://videos.pexels.com/video-files/7574545/portrait.mp4"},
            ],
        }
        self.assertIn("portrait.mp4", select_rendition(valid, "7574545")[0])
        for change in (
            {"id": 8}, {"url": "https://other.com/video/a-7574545/"},
            {"url": "https://www.pexels.com/video/wrong-8/"},
            {"duration": 2}, {"video_files": valid["video_files"][:1]},
            {"video_files": [{**valid["video_files"][1],
                              "link": "https://other.com/media.mp4"}]},
        ):
            with self.subTest(change=change), self.assertRaises(MediaApprovalError):
                select_rendition({**valid, **change}, "7574545")


if __name__ == "__main__":
    unittest.main()
