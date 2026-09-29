#!/usr/bin/env python3
"""Restore the published MSP data snapshot into an empty local state directory."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', type=Path)
parser.add_argument('--state-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'user-app/.wrangler/state')
args = parser.parse_args()
target = args.state_dir.resolve()
if target.exists():
    parser.error(f'Destination already exists: {target}. Choose a new --state-dir.')
target.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='.msp-restore-', dir=target.parent) as temporary:
    temporary = Path(temporary)
    with tarfile.open(args.archive, 'r:gz') as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive paths')
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or str(path) != member.name or not member.isfile():
                raise ValueError(f'Unsafe archive member: {member.name}')
        manifest = json.load(archive.extractfile('manifest.json'))
        if manifest.get('schemaVersion') != 1:
            raise ValueError('Unsupported snapshot format')
        expected = {entry['path']: entry for entry in manifest['files']}
        if len(expected) != len(manifest['files']) or set(names) != set(expected) | {'manifest.json'}:
            raise ValueError('Archive does not match the manifest')
        for name, entry in expected.items():
            member = archive.getmember(name)
            if member.size != entry['size']:
                raise ValueError(f'Wrong size: {name}')
            digest = hashlib.sha256()
            out = temporary / name
            out.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, out.open('xb') as destination:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
                    destination.write(chunk)
            if digest.hexdigest() != entry['sha256']:
                raise ValueError(f'Checksum mismatch: {name}')
    if not (temporary / 'state/v3').is_dir() or target.exists():
        raise ValueError('Missing snapshot state or destination already exists')
    (temporary / 'state').rename(target)
print(f'Restored {manifest["objectCount"]} objects into {target}')
