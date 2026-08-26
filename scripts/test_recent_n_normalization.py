import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which('node')
if not NODE:
    raise SystemExit('Node.js not found')

source = (ROOT / 'popup.js').read_text(encoding='utf-8')
source = source.rsplit('\ninit();', 1)[0]
cases = {
    '2.4': 2,
    '2.5': 3,
    '-5': 1,
    '101': 100,
    '0': 1,
    'null': 1,
    'undefined': 3,
    'Infinity': 3,
    '"bad"': 3,
}
script = source + '\nconst __out = {};\n' + '\n'.join(
    f'__out[{json.dumps(expr)}] = normalizeSettings({{recentExchanges:{expr}}}).recentExchanges;'
    for expr in cases
) + '\nconsole.log(JSON.stringify(__out));\n'
proc = subprocess.run([NODE, '-e', script], cwd=ROOT, check=True, text=True, capture_output=True)
actual = json.loads(proc.stdout.strip())
assert actual == cases, (actual, cases)
print('PASS recent-n-popup-normalization')
