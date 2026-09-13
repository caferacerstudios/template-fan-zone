#!/usr/bin/env python3
"""Set one team's public AdSense configuration. Does not build or deploy."""
import argparse
import json
import os
from pathlib import Path
import re
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('team')
    parser.add_argument('--phase', choices=['off', 'review', 'live'], required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    config = root / 'config/monetization.json'
    doc = json.loads(config.read_text())
    if args.team not in doc['teams']:
        raise ValueError('Add this team to config/monetization.json first.')
    team = doc['teams'][args.team]
    if args.phase != 'off':
        current = team.get('publisherId', '')
        entered = input(f'Public AdSense publisher ID [{current}]: ').strip() or current
        if entered.startswith('pub-'):
            entered = 'ca-' + entered
        if not re.fullmatch(r'ca-pub-\d{16}', entered):
            raise ValueError('Use your real public ca-pub- ID followed by 16 digits.')
        team['publisherId'] = entered
        if not team.get('productionHosts'):
            hosts = input('Approved production hostnames, comma separated: ').strip()
            team['productionHosts'] = [host.strip() for host in hosts.split(',') if host.strip()]
        if args.phase == 'live':
            print('Use live only after AdSense approves this domain and you publish its Google privacy messages.')
            print('Keep Auto ads off; configure the manual display units below. Blank keeps an existing value.')
            current = team.get('cmpScriptUrl', '')
            team['cmpScriptUrl'] = input(f'Google consent script src URL [{current}]: ').strip() or current
            for key in ['article-inline', 'article-end', 'feed-break', 'desktop-rail', 'stats-break']:
                current = team.setdefault('slots', {}).get(key, '')
                entered = input(f'{key} numeric ad unit ID (optional) [{current}]: ').strip() or current
                if entered and not re.fullmatch(r'\d{1,20}', entered):
                    raise ValueError('Ad unit IDs must be numeric.')
                team['slots'][key] = entered
            if not team['cmpScriptUrl'] or not any(team['slots'].values()):
                raise ValueError('Live needs the Google consent script and at least one ad unit.')
    team['phase'] = args.phase
    previous = config.read_bytes()
    from datetime import datetime, timezone
    backups = root / '.sites-runtime' / 'adsense-config'
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    (backups / f'{stamp}.json').write_bytes(previous)
    fd, temp = tempfile.mkstemp(prefix='.monetization-', dir=config.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(doc, out, indent=2)
            out.write('\n')
        os.chmod(temp, 0o644)
        os.replace(temp, config)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print(f'Saved {args.team}: {args.phase}. Other teams unchanged.')
    print(f'Next: bash template-tools/build-team.sh {args.team}')
    print('The build validates all public configuration before publishing. No build ran here.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, EOFError) as exc:
        raise SystemExit(f'Configuration stopped: {exc}')
