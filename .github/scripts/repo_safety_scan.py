#!/usr/bin/env python3
"""CI-gate repo safety scan (Section 11 / 12).

Deliberately narrow and mechanical: every check here is a precise,
false-positive-resistant pattern chosen specifically to avoid the two
failure modes a rigid scanner is prone to — flagging legitimate code (a
test asserting a bad pattern's ABSENCE, a doc explaining what not to do,
this project's own canonical single source of truth for a value) as a
violation, or missing a real regression because the pattern was too vague.
Broader, human-judgment-required review (evaluating a `curl`/`gh api` call
in its full context, `|| true` / `continue-on-error` misuse, etc.) is
reviewed periodically rather than encoded here, exactly to avoid either of
those failure modes.

Checks:
  1. Known-bad hardcoded credential/secret literals, outside comments.
  2. ADMIN_PASSWORD / ADMIN_TOKEN_SECRET never assigned a literal string
     default anywhere in executable source (must always come from
     process.env / os.environ — see server/auth.js's own fail-closed
     design).
  3. The real production fetch URLs (Render backend, Vercel frontend)
     never hardcoded outside their small, explicit allowlist of legitimate
     sources.
  4. generation_dispatch_enabled is never literally set to true anywhere.
  5. No unsafe automatic YouTube publication/upload API call in real
     (non-test) executable source.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SELF_PATH = pathlib.Path(__file__).resolve()

EXCLUDED_DIR_NAMES = {".git", "node_modules", "dist", "build", ".vite", ".vercel"}

# Only executable/config source — never markdown/docs, where discussing
# these exact strings as forbidden examples is expected and safe.
SCANNED_SUFFIXES = {".js", ".jsx", ".mjs", ".py", ".json", ".yml", ".yaml"}

FORBIDDEN_LITERALS = [
    "eren123",
    "eren-admin-token",
]

# The only files allowed to hardcode a real production fetch URL, relative
# to repo root, POSIX-style. Each entry's own legitimate reason:
#   - src/services/api.js: THE canonical fallback resolver (API_BASE_URL)
#   - src/services/api.test.js: tests that same resolver
#   - server/config/corsConfig.js: THE canonical CORS allowlist source
#     (moved here from server/corsConfig.js by the backend architecture
#     refactor)
#   - server/services/emailService.js: includes the real admin-panel URL in
#     an owner notification email body (not an API call) — moved here from
#     server/server.js by the same refactor
#   - .github/config/business-profile.json: the actual business config
#     (reservation_url etc.)
#   - .github/scripts/test_build_youtube_package.py: asserts the URL is
#     NOT hardcoded elsewhere
ALLOWED_PRODUCTION_URL_FILES = {
    "src/services/api.js",
    "src/services/api.test.js",
    "server/config/corsConfig.js",
    "server/services/emailService.js",
    ".github/config/business-profile.json",
    ".github/scripts/test_build_youtube_package.py",
}

PRODUCTION_URLS = [
    "eren-muzik-atolyesi-backend.onrender.com",
    "eren-muzik-atolyesi.vercel.app",
]

ADMIN_SECRET_VAR_NAMES = ["ADMIN_PASSWORD", "ADMIN_TOKEN_SECRET"]

UNSAFE_PUBLICATION_PATTERNS = [
    "youtube.googleapis.com",
    "videos.insert",
]


_JS_COMMENT_START = re.compile(r"(?<!:)//")


def strip_line_comments(text: str, suffix: str) -> str:
    lines = []
    for line in text.split("\n"):
        if suffix == ".py":
            idx = line.find("#")
        else:
            # A bare `find("//")` would misfire on any line containing a
            # URL (http://, https://) — the `//` right after the scheme
            # colon is not a comment start, and naively truncating there
            # would strip away exactly the URL text a check like
            # check_hardcoded_production_urls needs to see. The (?<!:)
            # lookbehind excludes that shape.
            match = _JS_COMMENT_START.search(line)
            idx = match.start() if match else -1
        lines.append(line[:idx] if idx >= 0 else line)
    return "\n".join(lines)


def iter_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.resolve() == SELF_PATH:
            continue
        if any(part in EXCLUDED_DIR_NAMES for part in path.parts):
            continue
        if path.suffix not in SCANNED_SUFFIXES:
            continue
        yield path


def relative_posix(path: pathlib.Path) -> str:
    return path.relative_to(ROOT).as_posix()


def check_forbidden_literals(rel_path: str, executable_text: str, violations: list[str]) -> None:
    for literal in FORBIDDEN_LITERALS:
        if literal in executable_text:
            violations.append(f"{rel_path}: contains forbidden literal '{literal}' outside a comment")


def check_admin_secret_defaults(rel_path: str, executable_text: str, violations: list[str]) -> None:
    # Test fixtures legitimately do `process.env.ADMIN_PASSWORD = "..."` /
    # `os.environ["ADMIN_PASSWORD"] = "..."` to configure a real,
    # intentional test environment — that is not a production default and
    # must not be flagged. The (?<!\.) lookbehind excludes exactly that
    # shape: a real hardcoded default (`const ADMIN_PASSWORD = "..."`,
    # `ADMIN_PASSWORD: "..."`) is never preceded by a `.`, whereas
    # `process.env.ADMIN_PASSWORD` / `env.ADMIN_PASSWORD` always is.
    for var_name in ADMIN_SECRET_VAR_NAMES:
        pattern = re.compile(rf"(?<!\.)\b{var_name}\b\s*[:=]\s*[\"']")
        if pattern.search(executable_text):
            violations.append(f"{rel_path}: {var_name} appears to be assigned a literal default value")


def check_hardcoded_production_urls(rel_path: str, executable_text: str, violations: list[str]) -> None:
    if rel_path in ALLOWED_PRODUCTION_URL_FILES:
        return
    for url in PRODUCTION_URLS:
        if url in executable_text:
            violations.append(f"{rel_path}: hardcodes production URL '{url}' outside its allowed source")


def check_generation_dispatch_enabled(rel_path: str, executable_text: str, violations: list[str]) -> None:
    if not rel_path.endswith(".json"):
        return
    if re.search(r'"generation_dispatch_enabled"\s*:\s*true\b', executable_text):
        violations.append(f"{rel_path}: generation_dispatch_enabled is literally set to true")


def check_unsafe_publication_commands(rel_path: str, executable_text: str, violations: list[str]) -> None:
    # Test files are explicitly allowed (and expected) to mention these
    # patterns as strings they assert are ABSENT elsewhere.
    basename = pathlib.PurePosixPath(rel_path).name
    if basename.startswith("test_") or basename.endswith(".test.js") or basename.endswith(".test.mjs"):
        return
    for pattern in UNSAFE_PUBLICATION_PATTERNS:
        if pattern in executable_text:
            violations.append(f"{rel_path}: contains an unsafe automatic publication pattern '{pattern}' outside a test file")


def main() -> None:
    violations: list[str] = []
    scanned = 0

    for path in iter_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        scanned += 1
        rel_path = relative_posix(path)
        executable_text = strip_line_comments(text, path.suffix)

        check_forbidden_literals(rel_path, executable_text, violations)
        check_admin_secret_defaults(rel_path, executable_text, violations)
        check_hardcoded_production_urls(rel_path, executable_text, violations)
        check_generation_dispatch_enabled(rel_path, executable_text, violations)
        check_unsafe_publication_commands(rel_path, executable_text, violations)

    if violations:
        print("Repo safety scan FAILED — deterministic safety check(s) failed:", file=sys.stderr)
        for violation in violations:
            print(f"  - {violation}", file=sys.stderr)
        raise SystemExit(1)

    print(f"repo_safety_scan_ok files_scanned={scanned} violations_found=0")


if __name__ == "__main__":
    main()
