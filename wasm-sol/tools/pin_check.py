"""Checks CHECKER_PIN against the tree: python3 -I tools/pin_check.py

The manifest of CHECKER_PIN has one line per file: `<sha256>  <path>  <origin>`, where origin is
`verbatim` (the file of the P3 crate, unchanged), `modified` (a file of the P3 crate with a
change that the notes name) or `new` (written for wasm-sol). The check fails if a listed file is
missing or has another hash, or if a file below src, tests, vectors or vendor is not listed.
"""

import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINE = re.compile(r"^([0-9a-f]{64})  (\S+)  (verbatim|modified|new)$")
TREES = ("src", "tests", "vectors", "vendor")


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def manifest():
    with open(os.path.join(ROOT, "CHECKER_PIN"), encoding="utf-8") as handle:
        found = [LINE.match(line.rstrip("\n")) for line in handle]
    return {m.group(2): (m.group(1), m.group(3)) for m in found if m}


def tree_files():
    for top in TREES:
        for base, _, names in os.walk(os.path.join(ROOT, top)):
            for name in names:
                yield os.path.relpath(os.path.join(base, name), ROOT)


def problems(listed):
    out = []
    for path, (want, _) in sorted(listed.items()):
        full = os.path.join(ROOT, path)
        if not os.path.isfile(full):
            out.append(f"missing: {path}")
        elif sha(full) != want:
            out.append(f"changed: {path}")
    out += [f"not listed: {path}" for path in sorted(set(tree_files()) - set(listed))]
    return out


def main():
    listed = manifest()
    found = problems(listed)
    counts = {kind: sum(1 for _, k in listed.values() if k == kind) for kind in
              ("verbatim", "modified", "new")}
    print(f"{len(listed)} files listed {counts}, {len(found)} problems")
    for line in found:
        print(f"  {line}")
    sys.exit(1 if found else 0)


main()
