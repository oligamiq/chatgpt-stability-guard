#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = ROOT / 'scripts' / 'live_site_baseline.json'
ARTIFACT_DIR = ROOT / 'artifacts'
DEFAULT_URL = 'https://chatgpt.com/share/6a71b843-4fcc-83eb-8eb5-42706097b7e0'
TURN_RE = re.compile(r'^conversation-turn-(\d+)$')
VOID_TAGS = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
DEPENDENCY_CLASS_TOKENS = {'group/scroll-root', 'group/tool-message', 'no-scrollbar', 'markdown', 'agent-turn'}
TURN_STABLE_ATTRS = {
    'data-testid', 'data-turn', 'data-turn-id', 'data-turn-id-container',
    'data-message-author-role', 'data-message-id', 'dir'
}


class Node:
    __slots__ = ('tag', 'attrs', 'parent')

    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent

    @property
    def classes(self):
        return set(str(self.attrs.get('class', '')).split())


class StructureParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.nodes = []

    def handle_starttag(self, tag, attrs):
        parent = self.stack[-1] if self.stack else None
        node = Node(tag, attrs, parent)
        self.nodes.append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.nodes.append(Node(tag, attrs, self.stack[-1] if self.stack else None))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return


def node_signature(node):
    attrs = sorted(name for name in node.attrs if name in TURN_STABLE_ATTRS)
    deps = sorted(node.classes & DEPENDENCY_CLASS_TOKENS)
    return {'tag': node.tag, 'attrs': attrs, 'dependency_classes': deps}


def ancestor_signature(turn):
    path = []
    node = turn
    for _ in range(12):
        if node is None:
            break
        path.append(node_signature(node))
        if 'group/scroll-root' in node.classes:
            break
        node = node.parent
    return path


def build_structure(html_text):
    parser = StructureParser()
    parser.feed(html_text)
    turns = [node for node in parser.nodes if TURN_RE.match(str(node.attrs.get('data-testid', '')))]
    scroll_roots = [node for node in parser.nodes if 'group/scroll-root' in node.classes]
    role_values = sorted({node.attrs.get('data-turn') for node in turns if node.attrs.get('data-turn')})
    attr_sets = sorted({tuple(sorted(name for name in node.attrs if name in TURN_STABLE_ATTRS)) for node in turns})
    paths = []
    seen_paths = set()
    for turn in turns:
        encoded = json.dumps(ancestor_signature(turn), sort_keys=True, separators=(',', ':'))
        if encoded not in seen_paths:
            seen_paths.add(encoded)
            paths.append(json.loads(encoded))
    paths.sort(key=lambda value: json.dumps(value, sort_keys=True))
    dependency_presence = {
        token: any(token in node.classes for node in parser.nodes)
        for token in sorted(DEPENDENCY_CLASS_TOKENS)
    }
    return {
        'schema_version': 1,
        'turn_tags': sorted({node.tag for node in turns}),
        'turn_roles': role_values,
        'turn_stable_attr_sets': [list(value) for value in attr_sets],
        'turn_to_scroll_root_paths': paths,
        'scroll_root_tags': sorted({node.tag for node in scroll_roots}),
        'dependency_class_presence': dependency_presence,
        'all_turn_ids_numeric': bool(turns) and all(TURN_RE.match(str(node.attrs.get('data-testid', ''))) for node in turns),
    }, turns, scroll_roots


def contract_errors(structure, turns, scroll_roots):
    errors = []
    if len(turns) < 4:
        errors.append(f'expected at least 4 mounted conversation turns, found {len(turns)}')
    if not {'user', 'assistant'}.issubset(set(structure['turn_roles'])):
        errors.append(f'expected user+assistant turn roles, found {structure["turn_roles"]}')
    if not structure['all_turn_ids_numeric']:
        errors.append('conversation turn ids are no longer numeric conversation-turn-* ids')
    if not scroll_roots:
        errors.append('group/scroll-root was not found')
    if structure['turn_tags'] != ['section']:
        errors.append(f'conversation turn root tag changed: {structure["turn_tags"]}')
    required_attrs = {'data-testid', 'data-turn', 'data-turn-id', 'data-turn-id-container'}
    if not any(required_attrs.issubset(set(attr_set)) for attr_set in structure['turn_stable_attr_sets']):
        errors.append('expected stable turn attributes are no longer present together')
    return errors


def is_challenge_page(html_text):
    lowered = html_text.lower()
    return 'just a moment...' in lowered and ('challenge-platform' in lowered or 'cf-chl' in lowered)


def find_chrome():
    chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
    if not chrome:
        raise RuntimeError('Chrome/Chromium not found')
    return chrome


def fetch_dom(url, timeout_seconds=45):
    chrome = find_chrome()
    last_error = ''
    for attempt in range(1, 4):
        with tempfile.TemporaryDirectory(prefix='csg-live-profile-') as profile:
            cmd = [
                chrome, '--headless=new', '--no-sandbox', '--disable-gpu',
                '--disable-dev-shm-usage', '--disable-background-networking',
                f'--user-data-dir={profile}', '--virtual-time-budget=12000',
                '--dump-dom', url,
            ]
            try:
                proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, timeout=timeout_seconds)
            except subprocess.TimeoutExpired:
                last_error = f'attempt {attempt}: Chrome timed out'
                continue
        if proc.returncode == 0 and len(proc.stdout) > 10000:
            if is_challenge_page(proc.stdout):
                last_error = f'attempt {attempt}: ChatGPT returned a bot/challenge page'
                if attempt < 3:
                    time.sleep(attempt)
                continue
            return proc.stdout
        last_error = f'attempt {attempt}: rc={proc.returncode} stderr={proc.stderr[-1200:]}'
    raise RuntimeError(f'could not load live ChatGPT page: {last_error}')


def diff_values(expected, current, path='root'):
    diffs = []
    if type(expected) is not type(current):
        return [f'{path}: type {type(expected).__name__} -> {type(current).__name__}']
    if isinstance(expected, dict):
        for key in sorted(set(expected) | set(current)):
            child = f'{path}.{key}'
            if key not in expected:
                diffs.append(f'{child}: added')
            elif key not in current:
                diffs.append(f'{child}: removed')
            else:
                diffs.extend(diff_values(expected[key], current[key], child))
        return diffs
    if isinstance(expected, list):
        if expected != current:
            diffs.append(f'{path}: changed from {expected!r} to {current!r}')
        return diffs
    if expected != current:
        diffs.append(f'{path}: {expected!r} -> {current!r}')
    return diffs


def write_diagnostics(url, structure, errors, diffs):
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        'target_url': url,
        'contract_errors': errors,
        'structure_diffs': diffs,
        'current_structure': structure,
    }
    target = ARTIFACT_DIR / 'live-site-contract.json'
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return target


def main():
    parser = argparse.ArgumentParser(description='Check ChatGPT live DOM compatibility contract.')
    parser.add_argument('--url', default=os.environ.get('CSG_LIVE_CHAT_URL', DEFAULT_URL))
    parser.add_argument('--baseline', type=Path, default=BASELINE_PATH)
    parser.add_argument('--update-baseline', action='store_true')
    parser.add_argument('--html-file', type=Path, help='Use saved HTML instead of the network (tests/debugging).')
    args = parser.parse_args()

    html_text = args.html_file.read_text(encoding='utf-8') if args.html_file else fetch_dom(args.url)
    if is_challenge_page(html_text):
        raise RuntimeError('ChatGPT returned a bot/challenge page instead of the conversation')
    structure, turns, scroll_roots = build_structure(html_text)
    errors = contract_errors(structure, turns, scroll_roots)

    if args.update_baseline:
        if errors:
            raise SystemExit('refusing to baseline an incompatible page: ' + '; '.join(errors))
        args.baseline.write_text(json.dumps(structure, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print(f'UPDATED live-site baseline: {args.baseline}')
        return 0

    if not args.baseline.exists():
        raise RuntimeError(f'baseline not found: {args.baseline}')
    expected = json.loads(args.baseline.read_text(encoding='utf-8'))
    diffs = diff_values(expected, structure)
    diagnostic_path = write_diagnostics(args.url, structure, errors, diffs)

    if errors or diffs:
        print('LIVE SITE CONTRACT FAILED', file=sys.stderr)
        for message in errors:
            print(f'- contract: {message}', file=sys.stderr)
        for message in diffs[:40]:
            print(f'- structure: {message}', file=sys.stderr)
        if len(diffs) > 40:
            print(f'- structure: ... {len(diffs) - 40} more differences', file=sys.stderr)
        print(f'Diagnostics: {diagnostic_path}', file=sys.stderr)
        return 2

    print(f'PASS live-site contract: {len(turns)} mounted turns; structure matches baseline')
    print(f'Diagnostics: {diagnostic_path}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        target = ARTIFACT_DIR / 'live-site-contract.json'
        target.write_text(json.dumps({'fatal_error': str(exc)}, indent=2) + '\n', encoding='utf-8')
        print(f'LIVE SITE CONTRACT ERROR: {exc}', file=sys.stderr)
        raise SystemExit(3)
