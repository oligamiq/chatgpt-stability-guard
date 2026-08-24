#!/usr/bin/env python3
from types import SimpleNamespace

import live_site_contract as live
from live_site_contract import build_structure, contract_errors, diff_values


def fixture(turn_tag='section', scroll_class='group/scroll-root'):
    turns = []
    roles = ['user', 'assistant', 'user', 'assistant']
    for index, role in enumerate(roles):
        turns.append(
            f'<{turn_tag} data-testid="conversation-turn-{index}" data-turn="{role}" '
            f'data-turn-id="id-{index}" data-turn-id-container="id-{index}" dir="auto">'
            f'<div class="agent-turn"><div class="markdown">x</div></div></{turn_tag}>'
        )
    return '<html><body><div class="%s"><main>%s</main></div></body></html>' % (
        scroll_class,
        ''.join(turns),
    )


def main():
    baseline, turns, roots = build_structure(fixture())
    assert not contract_errors(baseline, turns, roots), 'valid fixture rejected'
    assert not diff_values(baseline, baseline), 'identical structures must not drift'

    changed, changed_turns, changed_roots = build_structure(fixture(turn_tag='article'))
    errors = contract_errors(changed, changed_turns, changed_roots)
    assert any('root tag changed' in error for error in errors), errors
    assert diff_values(baseline, changed), 'tag change must alter fingerprint'

    no_scroll, no_scroll_turns, no_scroll_roots = build_structure(fixture(scroll_class='scroll-root-new'))
    errors = contract_errors(no_scroll, no_scroll_turns, no_scroll_roots)
    assert any('group/scroll-root' in error for error in errors), errors
    assert diff_values(baseline, no_scroll), 'scroll-root change must alter fingerprint'

    challenge = '<html>Just a moment...<script src="/cdn-cgi/challenge-platform/x"></script>' + ('x' * 11000)
    valid = '<html>' + ('y' * 11000) + '</html>'
    assert live.is_challenge_page(challenge), 'challenge page was not recognized'
    original_find_chrome = live.find_chrome
    original_run = live.subprocess.run
    original_sleep = live.time.sleep
    responses = iter([
        SimpleNamespace(returncode=0, stdout=challenge, stderr=''),
        SimpleNamespace(returncode=0, stdout=valid, stderr=''),
    ])
    try:
        live.find_chrome = lambda: '/bin/true'
        live.subprocess.run = lambda *args, **kwargs: next(responses)
        live.time.sleep = lambda _seconds: None
        assert live.fetch_dom('https://chatgpt.com/share/test') == valid, 'challenge response was not retried'
    finally:
        live.find_chrome = original_find_chrome
        live.subprocess.run = original_run
        live.time.sleep = original_sleep

    print('PASS live-site contract detector')


if __name__ == '__main__':
    main()
