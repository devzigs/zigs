#!/usr/bin/env python3
"""Exercise production recipient/Vault logic using isolated in-memory Keychain I/O.
No device Keychain, authentication prompt, credentials, network, or wallet is used.
The generated test copy replaces only external Keychain I/O and lock-key acquisition;
record validation, AES sealing/opening, migration verification and rollback are unchanged.
"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent
source = (root / 'Zigs/Vault.swift').read_text()

def replace_method(text, signature, body):
    begin = text.index(signature)
    start = text.index('{', begin)
    depth = 1
    end = start + 1
    while depth:
        if text[end] == '{': depth += 1
        if text[end] == '}': depth -= 1
        end += 1
    return text[:start + 1] + '\n' + body + '\n    ' + text[end - 1:]

source = replace_method(source, 'private static func read(_ account:', '''        if TestIO.readFailure || (account == "zf-recipients" && TestIO.bookReadFailure) { throw VaultError("Synthetic Keychain read failure") }
        return TestIO.items[account]''')
source = replace_method(source, 'private static func write(_ account:', '''        guard !TestIO.writeFailure else { return false }
        TestIO.items[account] = data
        return true''')
source = replace_method(source, 'private static func delete(_ account:', '        TestIO.items[account] = nil\n        if account == "zf-vault-key" { TestIO.key = nil }')
source = replace_method(source, 'private nonisolated static func readVaultKey()', '''        try await MainActor.run {
            guard let key = TestIO.key else { throw VaultError("Synthetic missing lock key") }
            return key
        }''')
a = source.index('        var cfError:', source.index('    func turnOn()'))
b = source.index('        vaultKey = key', a)
source = source[:a] + '''        let key = SymmetricKey(size: .bits256)
        TestIO.key = key.withUnsafeBytes { Data($0) }
''' + source[b:]
with tempfile.TemporaryDirectory(prefix='zigs-recipient-check-') as temp:
    work = Path(temp)
    (work / 'Vault.swift').write_text(source)
    exe = work / 'check'
    subprocess.run(['swiftc', '-parse-as-library', '-strict-concurrency=complete',
        '-target', 'arm64-apple-macos14', '-module-cache-path', '/private/tmp/zigs-recipient-test-cache',
        '-file-prefix-map', str(Path.home()) + '=/build', '-file-prefix-map', temp + '=/test',
        str(root / 'Zigs/RecipientBook.swift'), str(work / 'Vault.swift'),
        str(root / 'CheckRecipients/main.swift'), '-o', str(exe)], check=True)
    subprocess.run([str(exe)], check=True)
