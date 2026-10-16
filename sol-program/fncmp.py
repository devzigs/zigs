"""Compares the code of two unstripped SBF ELFs function by function.

Usage: python3 -I fncmp.py LLVM_OBJDUMP FIRST.so SECOND.so

Addresses, call offsets and Rust symbol hashes are masked, so two builds of the same code in
another layout or function order compare equal. Two functions with one name (two
monomorphizations) compare as a sorted list of bodies. Prints the names that differ.
"""

import re
import subprocess
import sys

HEADER = re.compile(r"^[0-9a-f]+ <(.*)>:$")
MASKS = (
    (re.compile(r"::h[0-9a-f]{16}"), ""),
    (re.compile(r"lddw (r\d+), 0x[0-9a-f]+"), r"lddw \1, A"),
    (re.compile(r"call -?0x[0-9a-f]+"), "call R"),
    (re.compile(r" <[^>]*>$"), ""),
)


def functions(objdump, path):
    """Returns {demangled name without hash: sorted list of masked bodies}."""
    out = subprocess.run(
        [objdump, "-d", "-C", "--no-show-raw-insn", path],
        capture_output=True, text=True, check=True,
    ).stdout
    bodies, current = {}, None
    for line in out.splitlines():
        header = HEADER.match(line)
        if header:
            name = MASKS[0][0].sub("", header.group(1))
            current = []
            bodies.setdefault(name, []).append(current)
        elif current is not None and ":" in line:
            instruction = line.split(":", 1)[1].strip()
            for pattern, replacement in MASKS:
                instruction = pattern.sub(replacement, instruction)
            current.append(instruction)
    return {name: sorted("\n".join(b) for b in found) for name, found in bodies.items()}


def main():
    objdump, first, second = sys.argv[1:4]
    a, b = functions(objdump, first), functions(objdump, second)
    differ = sorted(name for name in a.keys() | b.keys() if a.get(name) != b.get(name))
    count_a = sum(map(len, a.values()))
    count_b = sum(map(len, b.values()))
    print(f"functions: {count_a} and {count_b}; names whose code differs: {len(differ)}")
    for name in differ:
        print(f"  {name}")


if __name__ == "__main__":
    main()
