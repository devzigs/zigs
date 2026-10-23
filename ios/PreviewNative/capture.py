#!/usr/bin/env python3
"""Render actual native view sources with isolated synthetic adapters on macOS.

The temporary copy replaces startup, Keychain I/O, UserDefaults, networking and the
Rust bridge. No real wallet, credentials, files, authentication or server is opened.
This checks SwiftUI layout; it is not an iOS simulator or a funded wallet test.
"""
from pathlib import Path
import argparse
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', nargs='?')
args = parser.parse_args()
output = Path(args.output).resolve() if args.output else root.parent / 'docs/ux-redesign/visuals/native-continuation'
output.mkdir(parents=True, exist_ok=True)

def replace_body(text, signature, body):
    begin = text.index(signature)
    start = text.index('{', begin)
    depth, end = 1, start + 1
    while depth:
        if text[end] == '{': depth += 1
        if text[end] == '}': depth -= 1
        end += 1
    return text[:start + 1] + '\n' + body + '\n    ' + text[end - 1:]

with tempfile.TemporaryDirectory(prefix='zigs-native-layout-') as temp:
    work = Path(temp)
    for path in sorted((root / 'Zigs').glob('*.swift')):
        text = path.read_text().replace('UserDefaults.standard', 'PreviewDefaults.value').replace('NavigationLink', 'PreviewNavigationLink').replace('Image("Logo")', 'Image(nsImage: PreviewBrand.image)')
        if path.name == 'ZigsApp.swift': text = text.replace('@main\n', '')
        if path.name == 'Engine.swift':
            text = text.replace('import ZigsCore', '')
            text = replace_body(text, 'static func call(', '''        if method == "normalizeAddress", let address = args.first as? String { return address }
        throw ZigsError("Synthetic preview: engine operations are disabled.")''')
        if path.name == 'GroupModel.swift':
            text = replace_body(text, '    init()', '''        me = "synthetic-local-device"
        server = "http://127.0.0.1"
        password = ""
        name = "Test signer"''')
            text += (root / 'PreviewNative/fixture.swift').read_text()
        if path.name == 'Vault.swift':
            text = replace_body(text, '    init()', '        locked = false')
            text = replace_body(text, 'private static func read(_ account:', '        nil')
            text = replace_body(text, 'private static func write(_ account:', '        false')
            text = replace_body(text, 'private static func delete(_ account:', '        return')
            text = replace_body(text, 'private nonisolated static func readVaultKey()', '        throw VaultError("Authentication disabled in synthetic previews.")')
            text += '\n@MainActor extension Vault { func previewSeat(_ id: String) { secrets[id + ":1"] = ["keyPackage": ["synthetic": true]] } }\n'
        if path.name == 'Chain.swift':
            text = replace_body(text, '    func sync() async', '        return')
            text += '\n@MainActor extension Chain { func previewBalance() { balance = ["spendable": 240000001, "pending": 25000000, "max_send": 239980001, "height": 3200000] } }\n'
        if path.name == 'Store.swift':
            text = replace_body(text, '    func connect(', '        return')
            text = replace_body(text, '    func join(', '        return')
        (work / path.name).write_text(text)
    exe = work / 'capture'
    subprocess.run(['swiftc', '-parse-as-library', '-swift-version', '5', '-enable-bare-slash-regex',
        '-strict-concurrency=complete', '-target', 'arm64-apple-macos14',
        '-module-cache-path', '/private/tmp/zigs-native-module-cache',
        '-file-prefix-map', str(Path.home()) + '=/build', '-file-prefix-map', temp + '=/preview',
        *map(str, sorted(work.glob('*.swift'))), str(root / 'PreviewNative/main.swift'), '-o', str(exe)], check=True)
    subprocess.run([str(exe), str(output), str(root / 'Zigs/Assets.xcassets/Logo.imageset/logo.png')], check=True)
