"""Counts secret needles in every file under the given roots. Prints counts only.

python3 -I solspike/tools/leak_scan.py [ROOT ...]     (default root: the whole clone)

The needles come from tools/needle-sources.json. Each entry names a file (by the environment
variable `env`, with a default below the home folder, or by `file`) and its kind: "helius-url"
gives the URL and the bare api-key; "hex" gives a hex secret in five forms (hex, HEX, base64,
base64url, raw bytes); "key-json" gives a Solana keypair file (a JSON array of 64 bytes) as the
key and its seed in many forms. A missing required file stops the scan. A missing optional file
is reported and skipped. A root may be one file.
Symlinks are not followed. A file that cannot be read fails the scan. The scan tests its own
counter first with dummy secrets, also across a block boundary.
"""

import base64
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
CLONE = HERE.parents[1]
CHUNK = 1 << 22
KEY_NAME = "api-key"


def count_in_file(path, needles, size=CHUNK):
    """Occurrences of each needle (a dict label -> bytes) in one file, across block borders."""
    counts = {label: 0 for label in needles}
    tails = {label: b"" for label in needles}
    with open(path, "rb") as handle:
        while block := handle.read(size):
            for label, needle in needles.items():
                data = tails[label] + block
                counts[label] += data.count(needle)
                keep = len(needle) - 1
                tails[label] = data[-keep:] if keep else b""
    return counts


def regular_files(root):
    if root.is_file():  # a root may be one file (a log of a run)
        if not root.is_symlink():
            yield root
        return
    for base, _, names in os.walk(root, followlinks=False):
        for name in names:
            path = Path(base, name)
            if path.is_file() and not path.is_symlink():
                yield path


def tally(totals, found, shown):
    for label, n in found.items():
        totals[label] += n
        if n:
            print(f"  match in a file: {shown} ({label}, {n})")


def scan(roots, needles):
    """Returns (counts, files, unreadable) for every regular file below the roots."""
    totals = {label: 0 for label in needles}
    files, unreadable = 0, []
    for root in map(Path, roots):
        for path in regular_files(root):
            shown = path.name if root.is_file() else path.relative_to(root)
            try:
                found = count_in_file(path, needles)
            except OSError as err:
                unreadable.append(f"{shown}: {err.strerror}")
                continue
            files += 1
            tally(totals, found, shown)
    return totals, files, unreadable


def hex_forms(text):
    """The five forms of a hex secret. The values are bytes and are never printed."""
    raw = bytes.fromhex(text.strip())
    b64 = base64.b64encode(raw).rstrip(b"=")
    b64url = base64.urlsafe_b64encode(raw).rstrip(b"=")
    forms = {"hex": raw.hex().encode(), "base64": b64, "raw": raw}
    for label, value in (("HEX", raw.hex().upper().encode()), ("base64url", b64url)):
        if value not in forms.values():
            forms[label] = value
    return forms


def url_forms(text):
    key = parse_qs(urlparse(text.strip()).query).get(KEY_NAME, [""])[0]
    if not key:
        sys.exit("needle source: the URL has no api-key value, abort")
    return {"url": text.strip().encode(), "api-key": key.encode()}


BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def base58_of(raw):
    n, out = int.from_bytes(raw, "big"), ""
    while n:
        n, rest = divmod(n, 58)
        out = BASE58[rest] + out
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + out


def key_json_forms(text):
    """A Solana keypair file (a JSON array of 64 bytes): the full key and its seed, in the forms
    that a log or a file could hold. The values are bytes and are never printed."""
    values = json.loads(text)
    if not (isinstance(values, list) and len(values) == 64
            and all(isinstance(b, int) and 0 <= b < 256 for b in values)):
        sys.exit("needle source: not a keypair file of 64 bytes, abort")
    full = bytes(values)
    forms = {"json": json.dumps(values, separators=(",", ":")).encode(),
             "json-spaced": json.dumps(values).encode()}
    for name, raw in (("key", full), ("seed", full[:32])):
        b64 = base64.b64encode(raw)
        for label, value in ((f"{name}-hex", raw.hex().encode()),
                             (f"{name}-HEX", raw.hex().upper().encode()),
                             (f"{name}-base64", b64),
                             (f"{name}-base64-bare", b64.rstrip(b"=")),
                             (f"{name}-base64url", base64.urlsafe_b64encode(raw).rstrip(b"=")),
                             (f"{name}-base58", base58_of(raw).encode())):
            forms[label] = value
    return forms


KINDS = {"helius-url": url_forms, "hex": hex_forms, "key-json": key_json_forms}


def script_needles(src):
    """Needles that only a script can derive (role secrets of a test key). The script prints one
    hex secret per line to a pipe. Nothing is written to a file or put on a command line."""
    done = subprocess.run(["node", str(HERE / src["script"])], capture_output=True, check=True,
                          text=True)
    needles = {}
    for number, line in enumerate(done.stdout.split(), start=1):
        for form, value in hex_forms(line).items():
            needles[f"{src['script']}#{number}:{form}"] = value
    if not needles:
        sys.exit(f"needle script {src['script']} printed nothing, abort")
    return needles


def source_path(src, base):
    """The file of a source: the file that its variable `env` names, else `file` below `base`
    ("~/" is the home folder). None when the variable is unset and has no default."""
    if "env" not in src:
        return Path(base, src["file"])
    named = os.environ.get(src["env"])
    default = src.get("file", "")
    if named:
        return Path(named)
    return Path.home() / default[2:] if default.startswith("~/") else None


def file_needles(src, base):
    """The needles of one file source. An optional file that is missing is reported and skipped."""
    name = src.get("env") or src["file"]
    path = source_path(src, base)
    if path is None or not path.is_file():
        if src.get("required"):
            sys.exit(f"needle source missing (required): {name}")
        print(f"  optional needle source not present: {name}")
        return {}
    needles = {}
    for form, value in KINDS[src["kind"]](path.read_text(encoding="utf-8")).items():
        if not value:
            sys.exit(f"needle source {name}: empty {form} form, abort")
        needles[f"{name}:{form}"] = value
    return needles


def load_needles(base, sources):
    """Builds {label: bytes}. A label is "<name>:<form>"."""
    needles = {}
    for src in sources:
        needles.update(script_needles(src) if "script" in src else file_needles(src, base))
    return needles


def check_hidden(tmp, needles):
    """The scan must enter dot directories and read dot files (.git, .state, .wrangler)."""
    tree = Path(tmp, "tree")
    for rel in (".git/objects/ab/cd", ".state/chrome-profile/x", "plain/.dotfile", "a/.b/c/d.txt"):
        path = tree / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"z" + needles["short"] + b"z")
    totals, files, bad = scan([tree], needles)
    assert (totals["short"], files, bad) == (4, 4, []), f"hidden paths: {totals}, {files} files"


def check_key_json(tmp):
    """A keypair file gives the JSON text, the hex, base64 and base58 of the key and its seed."""
    sol = Path(tmp, "keys")
    sol.mkdir()
    sol.joinpath("k.json").write_text(json.dumps(list(range(64))))
    found = load_needles(sol, [{"file": "k.json", "kind": "key-json", "required": True}])
    raw = bytes(range(64))
    assert found["k.json:json"] == json.dumps(list(range(64)), separators=(",", ":")).encode()
    assert found["k.json:key-hex"] == raw.hex().encode()
    assert found["k.json:seed-hex"] == raw[:32].hex().encode()
    assert found["k.json:seed-base58"] == base58_of(raw[:32]).encode()
    assert base58_of(b"\0\0\1") == "112", "leading zero bytes are ones"
    marked = Path(tmp, "one.log")
    marked.write_bytes(b"line " + found["k.json:key-hex"] + b" end")
    totals, files, bad = scan([marked], found)
    assert (totals["k.json:key-hex"], files, bad) == (1, 1, []), "a root may be one file"
    sol.joinpath("short.json").write_text("[1, 2, 3]")
    try:
        load_needles(sol, [{"file": "short.json", "kind": "key-json"}])
    except SystemExit:
        return
    raise AssertionError("a keypair file of 3 bytes was accepted")


def self_test():
    short, long_ = b"short-dummy-0123456789", b"long-dummy-value-" + b"z" * 40
    with tempfile.TemporaryDirectory() as tmp:
        probe = Path(tmp, "probe.bin")
        probe.write_bytes(b"x" * 100 + short + b"y" * 50 + short + long_ + short)
        needles = {"short": short, "long": long_}
        whole = count_in_file(probe, needles)
        cut = count_in_file(probe, needles, size=7)
        _, files, bad = scan([tmp], needles)
        assert (whole, cut, files, bad) == ({"short": 3, "long": 1},) * 2 + (1, []), (whole, cut)
        check_hidden(tmp, needles)
        check_key_json(tmp)
        sol = Path(tmp, "sol")
        sol.mkdir()
        sol.joinpath("a.url").write_text(f"https://x.invalid/?{KEY_NAME}=dummykey0123456789\n")
        sol.joinpath("b.hex").write_text("00ff" * 16 + "\n")
        found = load_needles(sol, [{"file": "a.url", "kind": "helius-url", "required": True},
                                   {"file": "b.hex", "kind": "hex"},
                                   {"file": "none.hex", "kind": "hex"}])
        assert len(found) == 2 + 5 and found["a.url:api-key"] == b"dummykey0123456789", found
        sol.joinpath("c.url").write_text("https://x.invalid/\n")
        for bad_src in ({"file": "none.url", "kind": "helius-url", "required": True},
                        {"file": "c.url", "kind": "helius-url"}):
            try:
                load_needles(sol, [bad_src])
            except SystemExit:
                continue
            raise AssertionError(f"bad needle source accepted: {bad_src}")


def main():
    with contextlib.redirect_stdout(io.StringIO()):
        self_test()
    spec = json.loads((HERE / "needle-sources.json").read_text(encoding="utf-8"))
    needles = load_needles(Path.cwd(), spec["sources"])
    roots = [Path(r) for r in sys.argv[1:]] or [CLONE]
    totals, files, unreadable = scan(roots, needles)
    for label, n in totals.items():
        print(f"needle {label}: {n}")
    for item in unreadable:
        print(f"  unreadable: {item}")
    hits = sum(totals.values())
    print(f"files scanned: {files}, needles: {len(needles)}, matches: {hits}, "
          f"unreadable: {len(unreadable)}")
    sys.exit(0 if hits == 0 and not unreadable else 1)


main()
