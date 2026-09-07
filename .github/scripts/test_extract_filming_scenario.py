#!/usr/bin/env python3
from __future__ import annotations

import unittest

from extract_filming_scenario import extract_selected_scenario


class ExtractFilmingScenarioTests(unittest.TestCase):
    def test_keeps_internal_horizontal_rules(self) -> None:
        text = """# NİHAİ SENARYOLAR

## SENARYO 1: Birinci
A
---
B

## SENARYO 2: İkinci
C
---
D

## SENARYO 3: Üçüncü
Başlangıç
---
[KANCA]
İçerik A
---
[ANA AKIŞ]
İçerik B
---
[KAPANIŞ]
İçerik C
"""
        result = extract_selected_scenario(
            text,
            3,
            minimum_bytes=1,
            maximum_bytes=10000,
        )
        self.assertIn("[KANCA]", result["text"])
        self.assertIn("[ANA AKIŞ]", result["text"])
        self.assertIn("[KAPANIŞ]", result["text"])
        self.assertGreaterEqual(result["text"].count("---"), 3)

    def test_stops_at_next_scenario_heading(self) -> None:
        text = """## SENARYO 1: Birinci
alpha
---
beta
## SENARYO 2: İkinci
gamma
---
delta
"""
        result = extract_selected_scenario(
            text,
            1,
            minimum_bytes=1,
            maximum_bytes=10000,
        )
        self.assertIn("alpha", result["text"])
        self.assertIn("beta", result["text"])
        self.assertNotIn("gamma", result["text"])
        self.assertNotIn("SENARYO 2", result["text"])

    def test_last_scenario_runs_to_end_of_document(self) -> None:
        text = """## SENARYO 1: Birinci
alpha
## SENARYO 3: Son
ilk
---
ikinci
---
üçüncü
"""
        result = extract_selected_scenario(
            text,
            3,
            minimum_bytes=1,
            maximum_bytes=10000,
        )
        self.assertTrue(result["text"].endswith("üçüncü\n"))

    def test_duplicate_selected_heading_fails_closed(self) -> None:
        text = """## SENARYO 3: A
x
## SENARYO 3: B
y
"""
        with self.assertRaisesRegex(ValueError, "tam bir kez"):
            extract_selected_scenario(text, 3, minimum_bytes=1, maximum_bytes=10000)

    def test_minimum_byte_guard_is_preserved(self) -> None:
        text = "## SENARYO 3: Kısa\nx\n"
        with self.assertRaisesRegex(ValueError, "güvenli sınır dışında"):
            extract_selected_scenario(text, 3, minimum_bytes=1200, maximum_bytes=16000)


if __name__ == "__main__":
    unittest.main()
