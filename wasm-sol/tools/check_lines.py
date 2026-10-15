"""Fails if a source line has more than 100 characters: python3 -I tools/check_lines.py [PATH ...]

With no argument it checks the crate (build.sh, tools, src, tests) and the files of the Solana
spike outside it (web/test/sol-wasm.mjs, solspike/tools/role_vectors.mjs). It reads .rs, .py,
.mjs, .cjs and .sh files, skips symlinks, node_modules, target and vendor, and prints one line
per file that has a long line, never the line. It tests its own counter first on a temporary file
with a line of 100 and one of 101.
"""

import os
import sys
import tempfile

LIMIT = 100
SUFFIXES = (".rs", ".py", ".mjs", ".cjs", ".sh")
SKIP_DIRS = {"node_modules", "__pycache__", "target", "target-mut", "vendor"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = [os.path.join(ROOT, d) for d in ("build.sh", "tools", "src", "tests")]
DEFAULT += [os.path.join(os.path.dirname(ROOT), f) for f in (
    "web/test/sol-wasm.mjs", "solspike/tools/role_vectors.mjs")]


def long_lines(path):
    """The 1-based numbers of the lines of a file that are over the limit."""
    with open(path, encoding="utf-8") as handle:
        return [n for n, line in enumerate(handle, 1) if len(line.rstrip("\n")) > LIMIT]


def walk(path):
    for base, dirs, names in os.walk(path, followlinks=False):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in sorted(names):
            full = os.path.join(base, name)
            if name.endswith(SUFFIXES) and not os.path.islink(full):
                yield full


def source_files(paths):
    for path in paths:
        if os.path.isfile(path) and not os.path.islink(path):
            yield path
        else:
            yield from walk(path)


def check(paths):
    """Prints each file with long lines. Returns the number of lines that are too long."""
    total = 0
    for path in source_files(paths):
        found = long_lines(path)
        total += len(found)
        if found:
            print(f"{os.path.relpath(path, ROOT)}: {len(found)} lines over {LIMIT}, first at "
                  f"{found[0]}")
    return total


def self_test():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "probe.py")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("x" * LIMIT + "\n" + "y" * (LIMIT + 1) + "\n" + "z" * 5 + "\n")
        assert long_lines(path) == [2], long_lines(path)
        assert sum(1 for _ in source_files([tmp])) == 1


def main():
    self_test()
    total = check(sys.argv[1:] or DEFAULT)
    print(f"lines over {LIMIT}: {total}")
    sys.exit(0 if total == 0 else 1)


main()
