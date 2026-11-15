"""Apply reviewed local model integration to immutable upstream releases.

Every changed hunk must match exactly once. An incompatible upstream update is
rejected before building or stopping the running application.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile


def safe_file(root, name):
    parts = PurePosixPath(name).parts
    if not parts or '..' in parts or '\\' in name or ':' in name or name.startswith('/'):
        raise ValueError('Unsafe integration path')
    target = root.joinpath(*parts).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Integration path escapes root')
    return target


def added_source(integration, name):
    source = safe_file(integration / 'files', name)
    # Archived test source is a fixture, so node --test does not execute it twice.
    return source if source.is_file() else safe_file(integration / 'files', name + '.fixture')


def prepare(root, release, sha):
    root, release = Path(root).resolve(), Path(release).resolve()
    integration = root / 'integration'
    manifest = json.loads((integration / 'patches.json').read_text(encoding='utf-8'))
    files = [integration / 'patches.json', integration / 'prepare.py']
    files += [added_source(integration, name) for name in manifest['added']]
    digest = hashlib.sha256(b''.join(file.read_bytes() for file in files)).hexdigest()[:16]
    parent = root / 'integrated'
    parent.mkdir(exist_ok=True)
    target = parent / f'{sha}-{digest}'
    if (target / 'model-integration.json').is_file():
        return target
    with tempfile.TemporaryDirectory(prefix='prepare-', dir=parent) as temporary:
        staged = Path(temporary) / 'source'
        shutil.copytree(release, staged, ignore=shutil.ignore_patterns('.git', 'node_modules', 'data', 'dist', '__pycache__'))
        for name, hunks in manifest['changed'].items():
            file = safe_file(staged, name)
            text = file.read_text(encoding='utf-8')
            for hunk in hunks:
                if not hunk['old'] or text.count(hunk['old']) != 1:
                    raise RuntimeError(f'Local model integration is incompatible with {name}; keeping the running version')
                text = text.replace(hunk['old'], hunk['new'], 1)
            file.write_text(text, encoding='utf-8', newline='\n')
        for name in manifest['added']:
            file = safe_file(staged, name)
            if file.exists():
                raise RuntimeError(f'Upstream now owns {name}; integration review required')
            file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(added_source(integration, name), file)
        (staged / 'model-integration.json').write_text(json.dumps({'baseSha': sha, 'integration': digest, 'version': '1.2.0'}), encoding='utf-8')
        os.replace(staged, target)
    return target
