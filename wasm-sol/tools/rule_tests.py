"""Lists, for each rule, the tests that name it: python3 -I tools/rule_tests.py

A test names a rule when its body holds `Rule::<Name>` (or the bare name after `use Rule::*`
in a test file that imports the variants, except tests/real.rs). The table is written as
markdown to stdout, and the last line lists the rules that no test names.
"""

import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {"rule_table_matches_enum"}  # it prints a rule id, it does not refuse a message


def rules():
    text = open(f"{ROOT}/src/rule.rs", encoding="utf-8").read()
    body = text[text.index("rules! {"):]
    return re.findall(r'^\s{4}(\w+), "([a-z0-9-]+)", (\w+),', body, re.M)


def tests(path):
    text = open(path, encoding="utf-8").read()
    pieces = re.split(r"(?m)^#\[test\]\s*\nfn (\w+)\(", text)
    return [(pieces[i], pieces[i + 1]) for i in range(1, len(pieces) - 1, 2)]


def imports_variants(path):
    text = open(path, encoding="utf-8").read()
    return bool(re.search(r"Rule::\{self, \*\}|Rule::\*", text)) and not path.endswith("real.rs")


def names_rule(name, body, bare):
    explicit = re.search(rf"Rule::{name}\b", body)
    return bool(explicit) or (bare and bool(re.search(rf"\b{name}\b", body)))


def scan(path, table, found):
    """Adds the tests of one file to `found`, by rule name."""
    bare = imports_variants(path)
    for fn, body in tests(path):
        body = body.split("\n#[test]")[0]
        if fn in SKIP or path.endswith("real.rs"):
            continue
        for name, _, _ in table:
            if names_rule(name, body, bare):
                found[name].append(fn)


def main():
    table = rules()
    found = {name: [] for name, _, _ in table}
    for path in sorted(glob.glob(f"{ROOT}/tests/*.rs")):
        scan(path, table, found)
    print("| Rule id | Group | Tests that refuse a message by this rule |")
    print("|---|---|---|")
    for name, rid, group in table:
        names = ", ".join(f"`{n}`" for n in sorted(set(found[name]))) or "none"
        print(f"| `{rid}` | {group} | {names} |")
    missing = [rid for name, rid, _ in table if not found[name]]
    print(f"\nrules without a named test: {missing or 'none'}")


main()
