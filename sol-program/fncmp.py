"""Compares the code of two unstripped SBF ELFs function by function.

Usage: python3 -I fncmp.py LLVM_OBJDUMP FIRST.so SECOND.so

A function is compared by its demangled name without the Rust symbol hash, so two builds of
the same code in another layout or function order compare equal. A relative call and an `lddw`
of a function start become the name of the target function. An `lddw` of an address in a data
section becomes `D`, because data moves with the layout. Every other immediate stays, so a
changed constant shows. Two functions with one name (two monomorphizations) compare as a sorted
list of bodies. Prints the names that differ and exits 1 when one differs.
"""

import re
import subprocess
import sys

HEADER = re.compile(r"^([0-9a-f]+) <(.*)>:$")
INSTRUCTION = re.compile(r"^\s*([0-9a-f]+):\s+(.*?)(?: <[^>]*>)?$")
SECTION = re.compile(r"^\s*\d+ (\S+)\s+([0-9a-f]+) ([0-9a-f]+) DATA$")
SYMBOL_HASH = re.compile(r"::h[0-9a-f]{16}")
LDDW = re.compile(r"^lddw (r\d+), 0x([0-9a-f]+)$")
CALL = re.compile(r"^call (-?)0x([0-9a-f]+)$")


def objdump(tool, *args):
    return subprocess.run([tool, *args], capture_output=True, text=True, check=True).stdout


def data_ranges(tool, path):
    """The address ranges of the loaded data sections."""
    ranges = []
    for line in objdump(tool, "-h", path).splitlines():
        section = SECTION.match(line)
        if section and int(section.group(3), 16) != 0:
            start = int(section.group(3), 16)
            ranges.append((start, start + int(section.group(2), 16)))
    return ranges


def parse(tool, path):
    """Returns {start address: name} and [(name, [(address, instruction)])]."""
    starts, functions = {}, []
    for line in objdump(tool, "-d", "-C", "--no-show-raw-insn", path).splitlines():
        header = HEADER.match(line)
        instruction = INSTRUCTION.match(line)
        if header:
            name = SYMBOL_HASH.sub("", header.group(2))
            starts[int(header.group(1), 16)] = name
            functions.append((name, []))
        elif instruction and functions:
            functions[-1][1].append((int(instruction.group(1), 16), instruction.group(2)))
    return starts, functions


def normalize(address, text, starts, ranges):
    """One instruction with its addresses replaced by names or `D`."""
    lddw = LDDW.match(text)
    if lddw:
        value = int(lddw.group(2), 16)
        if value in starts:
            return f"lddw {lddw.group(1)}, {starts[value]}"
        if any(low <= value < high for low, high in ranges):
            return f"lddw {lddw.group(1)}, D"
        return text
    call = CALL.match(text)
    if call and text != "call -0x1":
        offset = int(call.group(2), 16) * (-1 if call.group(1) else 1)
        return f"call {starts.get(address + 8 * (offset + 1), 'R')}"
    return text


def functions(tool, path):
    """Returns {name: sorted list of normalized bodies}."""
    starts, parsed = parse(tool, path)
    ranges = data_ranges(tool, path)
    bodies = {}
    for name, instructions in parsed:
        body = "\n".join(normalize(a, t, starts, ranges) for a, t in instructions)
        bodies.setdefault(name, []).append(body)
    return {name: sorted(found) for name, found in bodies.items()}


def main():
    tool, first, second = sys.argv[1:4]
    a, b = functions(tool, first), functions(tool, second)
    differ = sorted(name for name in a.keys() | b.keys() if a.get(name) != b.get(name))
    count_a = sum(map(len, a.values()))
    count_b = sum(map(len, b.values()))
    print(f"functions: {count_a} and {count_b}; names whose code differs: {len(differ)}")
    for name in differ:
        print(f"  {name}")
    sys.exit(1 if differ else 0)


if __name__ == "__main__":
    main()
