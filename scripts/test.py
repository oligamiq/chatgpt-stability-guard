#!/usr/bin/env python3
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*cmd):
    print('+', ' '.join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def main():
    run(sys.executable, 'scripts/validate.py')
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js not found')
    for script in ('content.js', 'recent-window.js', 'popup.js', 'prehide.js'):
        run(node, '--check', script)
    run(sys.executable, 'scripts/test_old_app_errors.py')
    run(sys.executable, 'scripts/test_recent_window.py')
    run(sys.executable, 'scripts/test_loading_indicator.py')
    print('ALL TESTS OK')


if __name__ == '__main__':
    main()
