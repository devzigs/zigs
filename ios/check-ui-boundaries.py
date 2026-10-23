#!/usr/bin/env python3
"""Check that the native UX port preserves authoritative wallet and security operations."""
from pathlib import Path
import subprocess
import hashlib

root = Path(__file__).resolve().parents[1]
base = '33645815acfacef4ba5381e512381f6bd6e60c00'
# Preserve the newer web work present when the user requested publication.
web_reference = '3a56c39de6340216880aa49e68a7d3a87b5712e1'
approved_recipient_hashes = {'Vault': '82117c509eab7da8426055345e30efd35e49016bd440084bb99270f546609ff4', 'RecipientBook': '3b5680e638aeb117d54fe71a882f9d0d2c8cef9f640a44e64efdc4cec54e7365'}
checks = 0

def original(path, ref=base):
    return subprocess.check_output(['git', 'show', ref + ':' + path], cwd=root, text=True)

def current(path):
    return (root / path).read_text()

def check(value, label):
    global checks
    assert value, label
    checks += 1

def section(text, start, end):
    return text[text.index(start):text.index(end, text.index(start))]

for name in ['Engine', 'Chain', 'Store', 'GroupSigned', 'Signed', 'Chat', 'ChatModel', 'Lightwalletd']:
    path = 'ios/Zigs/' + name + '.swift'
    check(current(path) == original(path), name + ' must remain identical to the reference')
check(current('ios/Zigs/Backup.swift').split('// MARK: Views')[0]
      == original('ios/Zigs/Backup.swift').split('// MARK: Views')[0], 'backup validation, keys and restore rules')
model = current('ios/Zigs/GroupModel.swift')
a = model.index('    /// Invalidates local address-book presentation')
b = model.index('\n    @ObservationIgnored let store', a)
check(model[:a] + model[b:] == original('ios/Zigs/GroupModel.swift'), 'model has only the approved recipient extension')
for name in ['Vault', 'RecipientBook']:
    path = 'ios/Zigs/' + name + '.swift'
    check(hashlib.sha256((root / path).read_bytes()).hexdigest() == approved_recipient_hashes[name],
          name + ' reuses the preserved address-book implementation')
for name in ['main.swift', 'web.mjs']:
    path = 'ios/CheckBackup/' + name
    check(current(path) == original(path), 'original interop checks preserved')
for path, start, end in [
    ('ios/Zigs/ZigsApp.swift', '    private func create()', 'struct SettingsSheet:'),
    ('ios/Zigs/GroupView.swift', '    private func propose()', '/// 150_000_000'),
    ('ios/Zigs/GroupView.swift', 'private typealias StepInfo', 'struct Step:'),
    ('ios/Zigs/GroupView.swift', 'let maxPayees', 'struct SentRow:'),
    ('ios/Zigs/SessionView.swift', 'struct PaidOutput:', 'struct RecipientBox:'),
    ('ios/Zigs/SessionView.swift', 'func memoShown(', 'struct PayeeLine:'),
    ('ios/Zigs/SessionView.swift', 'func networkFee(', 'struct Breakdown:'),
]:
    check(section(current(path), start, end) == section(original(path), start, end), start + ' unchanged')
# The web checkout is a reference; this port must not edit it or the protocol/engine code.
for path in ['web', 'src', 'wasm', 'wasm-sol', 'sol-program', 'cf']:
    changed = subprocess.check_output(['git', 'diff', '--name-only', web_reference, '--', path], cwd=root, text=True)
    check(not changed.strip(), path + ' unchanged')
print(f'{checks} native scope and security-boundary checks passed.')
