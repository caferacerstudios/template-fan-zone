#!/usr/bin/env python3
"""Build one configured team using read-only host snapshots and the existing preview."""
import argparse
import json
import os
import re
from pathlib import Path
import shlex
import sys

ROOT = Path(__file__).resolve().parents[1]


def guides_enabled(root, environment=None):
    """Read only this checkout's explicit opt-in; an exported value wins."""
    environment = os.environ if environment is None else environment
    value = environment.get('FAN_ZONE_GUIDES_ENABLED')
    if value is None:
        try:
            lines = (Path(root) / '.env').read_text().splitlines()
        except FileNotFoundError:
            lines = []
        for line in lines:
            if not re.match(r'^\s*(?:export\s+)?FAN_ZONE_GUIDES_ENABLED\s*=', line):
                continue
            match = re.fullmatch(r'''\s*(?:export\s+)?FAN_ZONE_GUIDES_ENABLED\s*=\s*(['"]?)([01])\1\s*(?:#.*)?''', line)
            if not match:
                raise ValueError('FAN_ZONE_GUIDES_ENABLED must be 0 or 1')
            value = match[2]
    if value not in (None, '', '0', '1'):
        raise ValueError('FAN_ZONE_GUIDES_ENABLED must be 0 or 1')
    return value == '1'


def build_command(root, slug, config_file=None, *, stage_only=False):
    root = Path(root).resolve()
    config_file = Path(config_file or root / 'config/active-sites.json').resolve()
    document = json.loads(config_file.read_text())
    sites = document.get('fan_zone_active_sites', document)
    sites = json.loads(sites) if isinstance(sites, str) else sites
    if slug not in sites:
        raise ValueError(f'Unknown team {slug!r}; configured teams: {", ".join(sites)}')
    site = sites[slug]
    nfl_current = Path(site['nfl_snapshot_dir'])
    if not nfl_current.is_dir() and (slug != 'seahawks' or nfl_current.parent.exists()):
        raise ValueError(f'Missing NFL snapshot: {nfl_current}. Run refresh_nfl_snapshot_{slug} in the sfz_nfl_refresh DAG before building this team.')
    candidates = [Path(site[key]).parent for key in ('news_snapshot_dir', 'nfl_snapshot_dir', 'recap_snapshot_dir')]
    news_current = str(site['news_snapshot_dir'])
    if not news_current.endswith('-news/current'):
        raise ValueError('news_snapshot_dir must end in -news/current to select the team roster snapshot')
    candidates.append(Path(news_current[:-len('-news/current')] + '-roster/current').parent)
    use_guides = guides_enabled(root)
    if use_guides:
        guide_current = Path(news_current[:-len('-news/current')] + '-guides/current')
        if not guide_current.is_dir():
            raise ValueError(f'Missing guide snapshot: {guide_current}. Run the guide DAG successfully before opting this build in.')
        candidates.append(guide_current.parent)
    candidates.append(Path(site['eventspy']['schedule_file']).parent)
    mounts = []
    for directory in sorted(set(candidates), key=lambda value: len(value.parts)):
        if not directory.is_absolute() or ',' in str(directory):
            raise ValueError(f'Invalid snapshot directory: {directory}')
        # Mount parents so current -> snapshots/<run> continues to resolve. New
        # recap/news collections may not exist until their first scheduled task.
        if not directory.is_dir() or any(directory.is_relative_to(parent) for parent in mounts):
            continue
        mounts.append(directory)
    command = ['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}', '-v', f'{root}:/app', '-w', '/app']
    for directory in mounts:
        command += ['--mount', f'type=bind,src={directory},dst={directory},readonly']
    try:
        config_path = Path('/app') / config_file.relative_to(root)
    except ValueError:
        command += ['--mount', f'type=bind,src={config_file},dst=/tmp/active-sites.json,readonly']
        config_path = Path('/tmp/active-sites.json')
    if stage_only:
        command += ['-e', 'FANZONE_STAGE_ONLY=1']
    # Forward explicit 0 as well so a host override cannot be reversed by .env
    # when the build wrapper reads local settings inside the container.
    command += ['-e', f'FAN_ZONE_GUIDES_ENABLED={int(use_guides)}']
    command += ['-e', f'TEAM={slug}', '-e', f'ACTIVE_SITES_FILE={config_path}', '-e', 'NPM_CONFIG_CACHE=/tmp/npm-cache', 'node:22-bookworm', 'npm', 'run', 'build']
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('team', choices=['seahawks', 'broncos', 'packers', 'vikings', 'chiefs'])
    parser.add_argument('--dry-run', action='store_true', help='Check inputs and print the Docker command without building.')
    parser.add_argument('--stage-only', action='store_true', help='Build and validate in .team-build without replacing the served dist directory.')
    args = parser.parse_args()
    try:
        command = build_command(ROOT, args.team, os.environ.get('ACTIVE_SITES_FILE'), stage_only=args.stage_only)
        result = 'validated output stays in .team-build; dist/ is retained' if args.stage_only else 'a successful build updates dist/'
        print(f'Building {args.team} from {ROOT}; {result}.', flush=True)
        if args.dry_run:
            print(shlex.join(command))
            return
        os.execvp(command[0], command)
    except (ValueError, KeyError, OSError) as error:
        print(f'Build stopped: {error}', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
