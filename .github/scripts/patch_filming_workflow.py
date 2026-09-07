#!/usr/bin/env python3
from pathlib import Path

path = Path('.github/workflows/filming-package-agent-v4-router.yml')
text = path.read_text(encoding='utf-8')
start_marker = "          python3 - <<'PY'\n          from pathlib import Path\n          import json, os, re\n"
end_marker = "          PY\n\n          SELECTED_TITLE=$(jq -r '.title' /tmp/selected-script.json)"

start = text.find(start_marker)
if start < 0:
    raise SystemExit('inline extractor start marker not found')
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit('inline extractor end marker not found')

replacement = '''          MINIMUM_BYTES=1200
          if [[ "$TEST_MODE" == "true" ]]; then
            MINIMUM_BYTES=40
          fi
          python3 .github/scripts/extract_filming_scenario.py \\
            --input /tmp/final-scripts.md \\
            --scenario "$SELECTED_SCENARIO" \\
            --output /tmp/selected-script.md \\
            --meta /tmp/selected-script.json \\
            --minimum-bytes "$MINIMUM_BYTES" \\
            --maximum-bytes 16000

'''
text = text[:start] + replacement + text[end + len("          PY\n\n"):]
path.write_text(text, encoding='utf-8')
