#!/usr/bin/env python3
"""Gate UX/UI publication against the explicitly reviewed native presentation snapshot."""
import argparse
import subprocess
import sys

BRANCH = "codex/ux-ui-final"
# The user authorized publishing the reviewed Mac/iOS adaptation on 23 October 2026.
# The tree is reachable from the resulting integration commit; no local branch is required.
NATIVE_SNAPSHOT_TREE = "8e4a64d02d9f3110b7bfd296c8ebaa1378b8fbd3"
ROOTS = {"ios", "mac", "macos", "android", "mobile", "native"}
SUFFIXES = (".swift", ".pbxproj", ".storyboard", ".xib", ".entitlements", ".kt")
PARTS = (".xcodeproj", ".xcworkspace", ".xcassets")

def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()

def native(path):
    parts = path.lower().split("/")
    return parts[0] in ROOTS or path.lower().endswith(SUFFIXES) or any(
        part.endswith(PARTS) for part in parts
    )

parser = argparse.ArgumentParser()
parser.add_argument("--commit")
parser.add_argument("--ref")
args = parser.parse_args()
try:
    ref = args.ref or git("symbolic-ref", "--quiet", "--short", "HEAD")
    if ref.removeprefix("refs/heads/") != BRANCH:
        sys.exit(0)
    # A tree also represents the full staged snapshot, including additions/deletions.
    target = args.commit or git("write-tree")
    paths = git("diff", "--name-only", "-z", "--no-renames", target, "origin/main", "--")
    changed = [path for path in paths.split("\0") if path and native(path)]
    if changed and (any(path.split("/")[0] != "ios" for path in changed)
                    or git("rev-parse", target + ":ios") != NATIVE_SNAPSHOT_TREE):
        print("UX/UI native scope: only the reviewed Mac/iOS snapshot is authorized. "
              "Validate and explicitly review further native changes before updating its scope.",
              file=sys.stderr)
        sys.exit(1)
except subprocess.CalledProcessError:
    print("Could not verify the audited native scope; commit/push blocked.", file=sys.stderr)
    sys.exit(1)
