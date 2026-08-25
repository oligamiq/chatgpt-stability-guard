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
    for script in ('content.js', 'recent-window.js', 'popup.js', 'prehide.js', 'privacy.js'):
        run(node, '--check', script)
    run(node, '--check', 'scripts/live_site_smoke.mjs')
    run(sys.executable, 'scripts/test_old_app_errors.py')
    run(sys.executable, 'scripts/test_recent_window.py')
    run(sys.executable, 'scripts/test_loading_indicator.py')
    run(sys.executable, 'scripts/test_recent_analysis_skip.py')
    run(sys.executable, 'scripts/test_auto_continue.py')
    run(sys.executable, 'scripts/test_ui_isolation.py')
    run(sys.executable, 'scripts/test_generation_completion.py')
    run(sys.executable, 'scripts/test_summary_generation_completion.py')
    run(sys.executable, 'scripts/test_summary_history_stress.py')
    run(sys.executable, 'scripts/test_virtual_spacer_compaction.py')
    run(sys.executable, 'scripts/test_package.py')
    run(sys.executable, 'scripts/test_live_site_contract.py')
    run(sys.executable, 'scripts/test_live_site_smoke.py')
    print('ALL TESTS OK')


if __name__ == '__main__':
    main()
