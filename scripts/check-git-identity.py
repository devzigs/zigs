#!/usr/bin/env python3
"""Block personal commit attribution without printing the rejected identity."""
import argparse
import re
import subprocess
import sys

NAME = "Zigs Contributor"
EMAIL = "noreply@zigs.invalid"

def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()

def allowed(identity):
    return identity.startswith(NAME + " <" + EMAIL + "> ")

parser = argparse.ArgumentParser()
parser.add_argument("--current", action="store_true")
parser.add_argument("--commits")
args = parser.parse_args()
try:
    valid = True
    if args.current or not args.commits:
        valid = all(allowed(git("var", kind)) for kind in ("GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"))
    if args.commits:
        for sha in git("rev-list", args.commits).splitlines():
            fields = git("show", "-s", "--format=%an%n%ae%n%cn%n%ce%n%B", sha).splitlines()
            if fields[:4] != [NAME, EMAIL, NAME, EMAIL]:
                valid = False
            if any(email != EMAIL for email in re.findall(r"[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "\n".join(fields[4:]))):
                valid = False
            if re.search(r"(?im)^(?:co-authored-by|signed-off-by|reviewed-by|acked-by|tested-by):", "\n".join(fields[4:])):
                valid = False
            headers = git("cat-file", "commit", sha).split("\n\n", 1)[0]
            if re.search(r"(?m)^gpgsig(?:-sha256)? ", headers):
                valid = False
    if not valid:
        print("Personal commit attribution blocked. Use the anonymous identity documented in AGENTS.md.", file=sys.stderr)
        sys.exit(1)
except subprocess.CalledProcessError:
    print("Could not verify commit attribution; push/commit blocked.", file=sys.stderr)
    sys.exit(1)
