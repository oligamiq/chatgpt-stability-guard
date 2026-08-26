from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'recent-window.js').read_text(encoding='utf-8')


def function_body(name):
    match = re.search(rf'  function {re.escape(name)}\([^)]*\) \{{', SOURCE)
    assert match, name
    start = match.end()
    depth = 1
    i = start
    while i < len(SOURCE) and depth:
        if SOURCE[i] == '{': depth += 1
        elif SOURCE[i] == '}': depth -= 1
        i += 1
    assert depth == 0, name
    return SOURCE[start:i - 1]


context = function_body('buildSequenceContext')
assert 'new Map(state.sequence.map' in context
assert 'exchangeStartKeys()' in context

exchange = function_body('exchangeStartForKey')
assert 'activeContext.startPositions' in exchange
assert 'exchangeStartKeys()' not in exchange
assert 'state.sequence.indexOf' not in exchange

mark = function_body('markMountedTurns')
assert mark.count('buildSequenceContext()') == 1
assert 'markTurnElement(item.turn, context)' in mark
assert 'updateAccordion(context)' in mark

merge = function_body('mergeWindow')
assert 'const workingSet = new Set(working);' in merge
assert 'workingSet.has(key)' in merge
assert 'working.includes(' not in merge

for name in ('midSequenceBranchDiverged', 'bottomTailDiverged', 'pruneReplacedBottomTail'):
    body = function_body(name)
    assert 'new Map(state.sequence.map' in body, name
    assert 'state.sequence.indexOf' not in body, name
    assert 'state.sequence.includes' not in body, name


forget = function_body('forgetSequenceKeys')
assert 'stale.has(state.pendingBoundaryKey)' in forget
assert "state.pendingBoundaryKey = ''" in forget

observer = function_body('attachObserver')
assert 'if (!targetTurn)' in observer
assert 'registerTurnsInNode(node)' in observer
assert '!isOldKey(key)' not in observer
assert "targetTurn.classList.contains('csg-hidden-old-turn')" in observer

role_evidence = function_body('mutationContainsRoleEvidence')
assert "mutation.target.closest('.markdown')" in role_evidence

merge = function_body('mergeWindow')
assert 'const scrollDelta = currentTop - state.lastMergeScrollTop;' in merge
assert 'scrollDelta < -2' in merge and 'scrollDelta > 2' in merge

print('PASS recent-window-performance-contract')
