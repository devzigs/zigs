"""Estimates the length and the cyclomatic complexity of every Rust function.

python3 -I tools/complexity.py [files...]   (default: src and tests)

Complexity starts at 1 and adds 1 for each `if`, `for`, `while`, `loop`, `&&`, `||`, each
match arm (`=>`) and each `let ... else` (the `else` that starts a line or ends a `let` line).
The count is a text estimate, so it can overcount (a closure body counts for its function). It
prints each function above 8 or above 100 lines, and the maximum.
"""

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FN = re.compile(r"^\s*(?:pub(?:\([a-z]+\))?\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+(\w+)")
TOKEN = re.compile(r"\b(?:if|for|while|loop)\b|&&|\|\||=>")
LET_ELSE = re.compile(r"^\s*else\s*\{|^\s*let\b(?!.*\bif\b).*\belse\s*\{\s*$")


def strip(line):
    line = re.sub(r'"(?:\\.|[^"\\])*"', '""', line)
    line = re.sub(r"'(?:\\.|[^'\\])'", "''", line)
    return line.split("//")[0]


def branches(line):
    return len(TOKEN.findall(line)) + bool(LET_ELSE.match(line))


def function_end(lines, start):
    """The index of the last line of the function that starts at `start`."""
    depth, started = 0, False
    for at in range(start, len(lines)):
        text = strip(lines[at])
        depth += text.count("{") - text.count("}")
        started = started or "{" in text
        if started and depth <= 0:
            return at
        if not started and text.rstrip().endswith(";"):
            return at
    return start


def functions(path):
    """(name, first line, length, score) of each function of a file."""
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    out, at = [], 0
    while at < len(lines):
        match = FN.match(lines[at])
        end = function_end(lines, at) if match else at
        if match:
            score = 1 + sum(branches(strip(line)) for line in lines[at : end + 1])
            out.append((match.group(1), at + 1, end - at + 1, score))
        at = end + 1
    return out


def default_paths():
    found = glob.glob(f"{ROOT}/src/*.rs") + glob.glob(f"{ROOT}/tests/**/*.rs", recursive=True)
    return sorted(found)


def main():
    worst, count = (0, ""), 0
    for path in sys.argv[1:] or default_paths():
        for name, line, length, score in functions(path):
            count += 1
            worst = max(worst, (score, f"{os.path.relpath(path, ROOT)}:{name}"))
            if score > 8 or length > 100:
                print(f"{os.path.relpath(path, ROOT)}:{line} {name} lines={length} cc~{score}")
    print(f"{count} functions, highest estimate {worst[0]} ({worst[1]})")


main()
