#!/usr/bin/env python3
"""Redacted release-content checks; build packaging uses a positive file allowlist."""
import argparse
import re
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
RULES = {
    'private-home-path': rb'/(?:Users|home)/[A-Za-z0-9._-]+/',
    'api-token': rb'\bsk-[A-Za-z0-9_-]{20,}\b',
    'github-token': rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',
    'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
}
FORBIDDEN = {'workspace.json','auth.json','prefs.js','.env','.DS_Store'}
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--artifact',type=Path)
args=parser.parse_args()
root=(args.artifact or ROOT).resolve()
if args.artifact:
    paths=list(root.rglob('*'))
else:
    names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
    paths=[root/name for name in names if name]
failures=[];count=0
for file in paths:
    relative=file.relative_to(root)
    if file.is_symlink():
        if not file.resolve().is_relative_to(root): failures.append((relative,'external-symlink'))
        continue
    if not file.is_file(): continue # pinned submodule gitlinks are upstream, not personal files
    count+=1
    if file.name in FORBIDDEN or file.suffix in {'.p12','.p8','.keychain','.pdf','.map'}: failures.append((relative,'private-or-development-file'))
    data=file.read_bytes()
    for label,pattern in RULES.items():
        checked=data
        # This exact path is embedded in the official Electron framework's
        # public Chromium privacy URL, not a developer home directory.
        if label == 'private-home-path' and str(relative) == 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework':
            checked=checked.replace(b'https://www.quad9.net/home/' + b'privacy/',b'https://www.quad9.net/privacy/')
        if re.search(pattern,checked): failures.append((relative,label))
for file,label in failures: print(f'FAIL: {file} [{label}] (matched content redacted)')
print(f'Release content audit: {count} files; {len(failures)} findings')
raise SystemExit(bool(failures))
