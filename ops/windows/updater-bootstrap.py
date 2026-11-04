"""Stable installed entry point; load the updater from the accepted release."""
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
current = json.loads((ROOT / 'current.json').read_text(encoding='utf-8-sig'))
sha = current.get('sha', '')
if not re.fullmatch('[0-9a-f]{40}', sha):
    raise RuntimeError('Invalid deployed revision')
release = ROOT / 'releases' / sha
candidate = release / 'ops/windows/update-windows.py'
if not (release / 'ops/windows/release.json').is_file() or not candidate.is_file():
    candidate = ROOT / 'legacy-updater.py'
spec = importlib.util.spec_from_file_location('accepted_windows_updater', candidate)
implementation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(implementation)


def __getattr__(name):
    return getattr(implementation, name)


if __name__ == '__main__':
    if '--root' not in sys.argv:
        sys.argv += ['--root', str(ROOT)]
    sys.exit(implementation.main())
