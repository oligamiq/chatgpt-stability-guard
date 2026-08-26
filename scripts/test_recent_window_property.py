import random
from test_recent_window import run_case, turn


def make_body(start_turn, exchanges):
    out = []
    for i in range(exchanges):
        user = start_turn + i * 2
        out.extend([turn(user, 'user'), turn(user + 1, 'assistant')])
    return ''.join(out)


def main():
    rng = random.Random(0xC5A6)
    for case in range(12):
        exchanges = rng.randint(2, 12)
        n = rng.randint(1, exchanges)
        start = rng.randint(1, 40) * 2
        body = make_body(start, exchanges)
        boundary = start + (exchanges - n) * 2
        checks = [
            {'name': 'boundary-visible', 'selector': f'[data-testid="conversation-turn-{boundary}"]', 'hidden': False},
            {'name': 'latest-visible', 'selector': f'[data-testid="conversation-turn-{start + exchanges * 2 - 1}"]', 'hidden': False},
        ]
        if boundary > start:
            checks.append({'name': 'before-boundary-folded', 'selector': f'[data-testid="conversation-turn-{boundary - 1}"]', 'hidden': True})
        run_case(
            f'property-suffix-ready-{case}', f'/c/property-ready-{case}/', body, checks,
            n=n, boundary=f't:conversation-turn-{boundary}', expected_recent_mode='per-chat', expected_global_ui=False,
        )
    for case in range(8):
        exchanges = rng.randint(1, 5)
        n = rng.randint(exchanges + 1, min(12, exchanges + 6))
        start = rng.randint(20, 60) * 2
        body = make_body(start, exchanges)
        last = start + exchanges * 2 - 1
        run_case(
            f'property-virtualized-insufficient-{case}',
            f'/c/property-insufficient-{case}/', body,
            [
                {'name': 'first-mounted-visible', 'selector': f'[data-testid="conversation-turn-{start}"]', 'hidden': False},
                {'name': 'last-mounted-visible', 'selector': f'[data-testid="conversation-turn-{last}"]', 'hidden': False},
            ],
            n=n, delay=3600, expected_state='preparing', expected_global_ui=False,
        )

    print('RECENT WINDOW PROPERTY TESTS OK')


if __name__ == '__main__':
    main()
