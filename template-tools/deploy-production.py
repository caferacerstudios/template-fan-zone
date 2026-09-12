#!/usr/bin/env python3
"""Migrate the existing Seahawks nginx container to the modular checkout safely."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener, ProxyHandler
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = Path('/home/laurawkr/seahawksfanzone')
NAME = 'seahawksfanzone-web'
HOST = 'seahawksfanzone.com'
MIRROR = Path('/var/lib/sfz-eventspy-mirror/dev/public')
CONFIG_DEST = '/etc/nginx/conf.d/default.conf'
OLD_HTML = '/usr/share/nginx/html'
NEW_HTML = '/site/dist'


def run(args, *, capture=True):
    result = subprocess.run([str(a) for a in args], text=True, capture_output=capture)
    if result.returncode:
        detail = (result.stderr or result.stdout or '').strip() if capture else ''
        raise RuntimeError(f'{args[0]} {args[1]} failed (exit {result.returncode})' + (f': {detail}' if detail else ''))
    return result.stdout if capture else ''


def block_at(text, start):
    """Return one brace-delimited nginx block, respecting quoted JSON strings."""
    opening = text.index('{', start)
    depth = 0
    quote = None
    escaped = False
    comment = False
    for index in range(opening, len(text)):
        char = text[index]
        if comment:
            comment = char != '\n'
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
        elif char == '#':
            comment = True
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if not depth:
                return text[start:index + 1]
    raise ValueError('Unclosed nginx configuration block')


def adapt_config(config, old_root):
    if '{team}' in config or '{TEAM}' in config:
        raise ValueError('The active nginx configuration contains unresolved team placeholders')
    roots = re.findall(r'^\s*root\s+([^;]+);', config, re.M)
    if roots != [old_root]:
        raise ValueError(f'Expected one active nginx root at {old_root}; found {roots}')
    if len(re.findall(r'^\s*server\s*\{', config, re.M)) != 1:
        raise ValueError('Expected the existing single-server nginx configuration')
    config = re.sub(r'(^\s*root\s+)' + re.escape(old_root) + r';', r'\g<1>/site/dist;', config, count=1, flags=re.M)
    location = re.search(r'location\s+\^~\s+/data/eventspy-mirror/\s*\{', config)
    if not location:
        raise ValueError('The existing EventSpy nginx location was not found')
    legacy = block_at(config, location.start())
    if not re.search(r'\balias\s+/srv/eventspy-mirror/;', legacy):
        raise ValueError('The existing EventSpy location has an unrecognized alias')
    team = re.search(r'location\s+\^~\s+/data/eventspy-mirror/seahawks/\s*\{', config)
    if team:
        if not re.search(r'\balias\s+/srv/eventspy-mirror/;', block_at(config, team.start())):
            raise ValueError('The Seahawks EventSpy location points to a different directory')
    else:
        clone = legacy.replace('/data/eventspy-mirror/', '/data/eventspy-mirror/seahawks/', 1)
        config = config[:location.start()] + clone + '\n\n  ' + config[location.start():]
    return config


def inspect_layout(root, inspect, config):
    if inspect.get('Name') != '/' + NAME or not inspect.get('State', {}).get('Running'):
        raise ValueError(f'Expected the running {NAME} container')
    image = inspect.get('Image', '')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
        raise ValueError('Expected the running container\'s immutable image ID')
    host = inspect.get('HostConfig', {})
    if host.get('Privileged') or host.get('NetworkMode') in ('host', 'none'):
        raise ValueError('Unrecognized privileged or host-network production container')
    if inspect.get('Config', {}).get('User', '') not in ('', '0', 'root', '0:0'):
        raise ValueError('Expected the existing root-started nginx image')
    if host.get('CapAdd') or host.get('CapDrop') or host.get('SecurityOpt') or host.get('Tmpfs'):
        raise ValueError('Production has additional container security options; review before migration')
    mounts = inspect.get('Mounts', [])
    by_dest = {item['Destination']: item for item in mounts}
    if len(by_dest) != len(mounts) or any(item.get('Type') != 'bind' or item.get('RW') for item in mounts):
        raise ValueError('Expected unique read-only bind mounts on the existing nginx container')
    if CONFIG_DEST not in by_dest:
        raise ValueError('Expected the existing default.conf bind mount')
    if OLD_HTML in by_dest and Path(by_dest[OLD_HTML]['Source']).resolve() == (root / 'dist').resolve():
        html_dest, stable = OLD_HTML, False
    elif '/site' in by_dest and Path(by_dest['/site']['Source']).resolve() == root.resolve():
        html_dest, stable = '/site', True
    elif OLD_HTML in by_dest:
        # A prior failed cutover serves its captured pages until a retry succeeds.
        captured = Path(by_dest[OLD_HTML]['Source']).resolve()
        if captured.name != 'served-dist' or captured.parent.parent != root / '.sites-runtime' or not captured.parent.name.startswith('production-deploy-'):
            raise ValueError('The production nginx container does not serve this checkout')
        receipt = json.loads((captured.parent / 'deployment.json').read_text())
        if receipt.get('status') != 'rolled-back' or receipt.get('root') != str(root):
            raise ValueError('The captured rollback site does not have a matching deployment receipt')
        html_dest, stable = OLD_HTML, False
    else:
        raise ValueError('The production nginx container does not serve this checkout')
    old_root = NEW_HTML if stable else OLD_HTML
    proposed = adapt_config(config, old_root)
    mirror = by_dest.get('/srv/eventspy-mirror')
    if not mirror or Path(mirror['Source']).resolve() != MIRROR.resolve():
        raise ValueError(f'Expected Seattle EventSpy output at {MIRROR} mounted at /srv/eventspy-mirror')
    extra_mounts = [item for item in mounts if item['Destination'] not in (html_dest, CONFIG_DEST)]
    if any(item['Destination'] == '/site' or item['Destination'].startswith('/site/') or item['Destination'].startswith('/etc/nginx/') for item in extra_mounts):
        raise ValueError('Additional nginx or /site mount requires manual review')
    ports = host.get('PortBindings', {})
    if set(ports) != {'80/tcp'} or not ports['80/tcp'] or any(str(item.get('HostPort')) != '4322' for item in ports['80/tcp']):
        raise ValueError('Expected production to publish only container port 80 at host port 4322')
    restart = host.get('RestartPolicy', {})
    if restart.get('Name', 'no') not in ('no', 'always', 'unless-stopped', 'on-failure'):
        raise ValueError('Unrecognized restart policy')
    for mount in extra_mounts:
        if not Path(mount['Source']).exists() or ',' in mount['Source'] or ',' in mount['Destination']:
            raise ValueError(f'Unavailable or unrepresentable data mount: {mount["Destination"]}')
    if not MIRROR.is_dir():
        raise ValueError(f'Existing Seattle EventSpy output is missing: {MIRROR}')
    return {'image': image, 'network': host.get('NetworkMode') or 'bridge',
            'restart': restart, 'ports': ports['80/tcp'], 'extra_mounts': extra_mounts,
            'read_only': bool(host.get('ReadonlyRootfs')), 'stable': stable,
            'html_root': old_root, 'config': proposed}


def mount_args(source, destination):
    if ',' in str(source) or ',' in str(destination):
        raise ValueError('Docker bind paths must not contain commas')
    return ['--mount', f'type=bind,src={source},dst={destination},readonly']


def container_command(layout, root, conf, *, name=None, document_root=None, test=False):
    command = ['docker', 'run', '--pull=never']
    if test:
        command += ['--rm', '--network', 'none']
    else:
        command += ['-d', '--name', name or NAME, '--network', layout['network']]
        restart = layout['restart'].get('Name', 'no') or 'no'
        retries = layout['restart'].get('MaximumRetryCount', 0)
        if restart == 'on-failure' and retries:
            restart += f':{retries}'
        command += ['--restart', restart]
        for binding in layout['ports']:
            address = binding.get('HostIp', '')
            if ':' in address:
                address = f'[{address}]'
            prefix = f'{address}:' if address else ''
            command += ['--publish', f'{prefix}{binding["HostPort"]}:80/tcp']
    if layout['read_only']:
        command += ['--read-only']
    command += mount_args(document_root or root, OLD_HTML if document_root else '/site')
    command += mount_args(conf, CONFIG_DEST)
    for item in layout['extra_mounts']:
        command += mount_args(item['Source'], item['Destination'])
    command += ['--entrypoint', 'nginx', layout['image']]
    command += ['-t'] if test else ['-g', 'daemon off;']
    return command


def compose_document(layout, root, conf):
    service = {'container_name': NAME, 'image': layout['image'], 'pull_policy': 'never',
               'entrypoint': ['nginx'], 'command': ['-g', 'daemon off;'],
               'network_mode': layout['network'], 'read_only': layout['read_only'],
               'volumes': [{'type': 'bind', 'source': str(root), 'target': '/site', 'read_only': True},
                           {'type': 'bind', 'source': str(conf), 'target': CONFIG_DEST, 'read_only': True}],
               'ports': [{'target': 80, 'published': str(row['HostPort']), 'host_ip': row.get('HostIp') or '0.0.0.0', 'protocol': 'tcp'} for row in layout['ports']]}
    policy = layout['restart'].get('Name', 'no') or 'no'
    if policy == 'on-failure' and layout['restart'].get('MaximumRetryCount'):
        policy += ':' + str(layout['restart']['MaximumRetryCount'])
    service['restart'] = policy
    service['volumes'] += [{'type': 'bind', 'source': item['Source'], 'target': item['Destination'], 'read_only': True} for item in layout['extra_mounts']]
    return {'services': {'web': service}}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def fetch(path):
    request = Request('http://127.0.0.1:4322' + path, headers={'Host': HOST, 'Accept-Encoding': 'identity'})
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=5) as response:
        if response.geturl() != request.full_url:
            raise ValueError('Unexpected production redirect during origin verification')
        return response.status, response.read()


def verify_origin(expected):
    last_error = None
    for attempt in range(12):
        try:
            status, actual = fetch('/')
            if status != 200 or hashlib.sha256(actual).digest() != hashlib.sha256(expected).digest():
                raise ValueError('Production homepage does not match the validated Seahawks build')
            return
        except (OSError, ValueError, URLError) as error:
            last_error = error
            if attempt < 11:
                time.sleep(1)
    raise RuntimeError(f'Origin verification failed: {last_error}')


def ticket_sample():
    files = sorted(path for path in MIRROR.glob('*.json') if re.fullmatch(r'\d+\.json', path.name))
    if not files:
        raise ValueError('No existing Seattle EventSpy game JSON is available for route verification')
    chosen = files[0]
    source = json.loads(chosen.read_text())
    if source.get('source') != 'eventspy' or str(source.get('gameId')) != chosen.stem:
        raise ValueError('Existing EventSpy verification sample has an unexpected identity')
    return chosen


def verify_tickets():
    chosen = ticket_sample()
    for prefix in ('/data/eventspy-mirror/', '/data/eventspy-mirror/seahawks/'):
        status, body = fetch(prefix + chosen.name)
        document = json.loads(body)
        if status != 200 or document.get('source') != 'eventspy' or str(document.get('gameId')) != chosen.stem:
            raise ValueError(f'Production did not serve the expected Seattle ticket feed at {prefix}{chosen.name}')


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def validate_stage(stage):
    if stage.is_symlink() or not stage.is_dir():
        raise ValueError('The staged Seahawks build is missing or is a symlink')
    html = (stage / 'index.html').read_bytes()
    lowered = html.lower()
    if b'seahawks fan zone' not in lowered or b'https://seahawksfanzone.com/' not in lowered or b'{team}' in lowered:
        raise ValueError('The staged homepage is not the expected production Seahawks build')
    if not (stage / 'data/news-front-page.json').is_file():
        raise ValueError('The staged build is missing the news feed')
    return html


def publish_stage(root, stage, backup):
    old = root / 'dist'
    if old.is_symlink() or not old.is_dir():
        raise ValueError('Expected an ordinary existing production dist directory')
    os.rename(old, backup)
    try:
        os.rename(stage, old)
    except BaseException:
        os.rename(backup, old)
        raise


def restore_dist(root, previous, failed):
    if (root / 'dist').exists():
        os.rename(root / 'dist', failed)
    os.rename(previous, root / 'dist')


def deploy(root, apply=False):
    root = root.resolve()
    if root != PRODUCTION:
        raise ValueError(f'Run this production migration from {PRODUCTION}; other checkouts use build-team.sh')
    if os.geteuid() == 0:
        raise ValueError('Run as laurawkr, without sudo')
    origin = run(['git', '-C', root, 'remote', 'get-url', 'origin']).strip()
    if origin not in ('git@github.com:caferacerstudios/template-fan-zone.git', 'https://github.com/caferacerstudios/template-fan-zone.git', 'https://github.com/caferacerstudios/template-fan-zone'):
        raise ValueError('Production origin must be caferacerstudios/template-fan-zone')
    inspected = json.loads(run(['docker', 'inspect', NAME]))
    if len(inspected) != 1:
        raise ValueError('Expected exactly one production container')
    run(['docker', 'exec', NAME, 'nginx', '-t'])
    active_config = run(['docker', 'exec', NAME, 'cat', CONFIG_DEST])
    layout = inspect_layout(root, inspected[0], active_config)
    if (root / 'dist').is_symlink() or not (root / 'dist').is_dir():
        raise ValueError('Expected an ordinary existing production dist directory')
    ticket_sample()
    print(f'Verified {NAME}: port 4322, exact running image, Seattle ticket mounts, and {layout["html_root"]}.')
    if not apply:
        print('Check complete. No build, container, configuration or served files were changed.')
        return
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid4().hex[:8]
    private = root / '.sites-runtime'
    if private.is_symlink():
        raise ValueError('Refusing a symlink at the deployment backup directory')
    private.mkdir(mode=0o700, exist_ok=True)
    private.chmod(0o700)
    backup = private / ('production-deploy-' + stamp)
    backup.mkdir(mode=0o700)
    old_config = backup / 'previous-default.conf'
    old_config.write_text(active_config)
    old_config.chmod(0o644)
    new_config = backup / 'default.conf'
    new_config.write_text(layout['config'])
    new_config.chmod(0o644)
    served = backup / 'served-dist'
    served.mkdir(mode=0o755)
    run(['docker', 'cp', NAME + ':' + layout['html_root'] + '/.', served])
    old_home = (served / 'index.html').read_bytes()
    if not old_home:
        raise ValueError('The currently served homepage backup is empty')
    # Preserve exactly what nginx can read, even if an old bind mount pins an inode
    # no longer reachable through the checkout's current dist path.
    rollback_conf = backup / 'rollback-default.conf'
    rollback_conf.write_text(re.sub(r'(^\s*root\s+)' + re.escape(layout['html_root']) + ';', r'\g<1>/usr/share/nginx/html;', active_config, count=1, flags=re.M))
    rollback_conf.chmod(0o644)
    save_json(backup / 'compose.json', compose_document(layout, root, new_config))
    save_json(backup / 'rollback-command.json', container_command(layout, root, rollback_conf, document_root=served))
    run(container_command(layout, root, rollback_conf, document_root=served, test=True))
    print('Captured the serving configuration and pages. Building Seahawks without replacing production dist/.', flush=True)
    run(['bash', root / 'template-tools/build-team.sh', 'seahawks', '--stage-only'], capture=False)
    stage = root / '.team-build/seahawks/dist'
    marker = json.loads((root / '.team-build/staged-build.json').read_text())
    if marker.get('team') != 'seahawks':
        raise ValueError('The successful staged-build receipt is not for Seahawks')
    expected = validate_stage(stage)
    # nginx syntax and mounts are tested while the original keeps serving.
    run(container_command(layout, root, new_config, test=True))
    previous = backup / 'previous-checkout-dist'
    failed_dist = backup / 'failed-dist'
    saved_container = NAME + '-before-modular-' + stamp
    receipt = {'status': 'ready', 'oldContainer': saved_container, 'image': layout['image'],
               'root': str(root), 'backup': str(backup), 'team': 'seahawks'}
    save_json(backup / 'deployment.json', receipt)
    stopped = renamed = published = False
    try:
        if not layout['stable'] or layout['config'] != active_config:
            run(['docker', 'stop', NAME])
            stopped = True
            run(['docker', 'rename', NAME, saved_container])
            renamed = True
            # A retained container must not contend for port 4322 after a reboot.
            # The replacement (or rollback container) gets the original policy.
            run(['docker', 'update', '--restart=no', saved_container])
        publish_stage(root, stage, previous)
        published = True
        if renamed:
            run(container_command(layout, root, new_config))
        verify_origin(expected)
        verify_tickets()
    except BaseException as error:
        print('Deployment verification failed; restoring the previously served site.', file=sys.stderr, flush=True)
        if published:
            restore_dist(root, previous, failed_dist)
        if stopped:
            if renamed:
                # A failed docker run may leave a stopped candidate with the name.
                state = subprocess.run(['docker', 'inspect', NAME], capture_output=True, text=True)
                if state.returncode == 0:
                    run(['docker', 'rm', '-f', NAME])
            else:
                run(['docker', 'rename', NAME, saved_container])
            run(container_command(layout, root, rollback_conf, document_root=served))
        verify_origin(old_home)
        receipt['status'] = 'rolled-back'
        save_json(backup / 'deployment.json', receipt)
        raise RuntimeError(f'{error}; the previous serving pages were restored. Backup: {backup}') from error
    receipt['status'] = 'deployed'
    receipt['previousContainerRetained'] = renamed
    save_json(backup / 'deployment.json', receipt)
    print(f'Deployed Seahawks at http://127.0.0.1:4322 (Host: {HOST}). Homepage and both Seattle ticket routes passed.')
    print(f'Backup retained: {backup}')
    if renamed:
        print(f'Previous container retained, stopped: {saved_container}')
    print('Future builds: bash template-tools/build-team.sh seahawks. No Docker recreation is needed after a successful build.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Inspect the existing production layout without changes (default).')
    mode.add_argument('--apply', action='store_true', help='Stage, verify and deploy Seahawks, retaining a rollback copy.')
    args = parser.parse_args()
    try:
        deploy(ROOT, apply=args.apply)
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f'Production deployment stopped: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
