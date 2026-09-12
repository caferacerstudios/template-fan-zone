"""Fixture-only checks: no Docker daemon, live site, or collectors are used."""
import importlib.util
from contextlib import redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('production_deploy', Path(__file__).with_name('deploy-production.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

CONFIG = '''server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  if ($host = www.seahawksfanzone.com) { return 301 https://seahawksfanzone.com$request_uri; }
  location ^~ /data/tickets/ { alias /srv/ticket-data/current/; }
  location ^~ /data/eventspy-mirror/ {
    alias /srv/eventspy-mirror/;
    autoindex off;
    types { application/json json; }
    error_page 404 = @eventspy_mirror_unavailable;
  }
  location @eventspy_mirror_unavailable { return 404 '{"error":"unavailable"}'; }
  location / { try_files $uri $uri/index.html =404; }
}
'''
NEW_HOME = b'<html><title>Seahawks Fan Zone</title><link rel="canonical" href="https://seahawksfanzone.com/"></html>'


class ProductionDeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'seahawksfanzone'
        self.root.mkdir()
        (self.root / 'dist').mkdir()
        (self.root / 'dist/index.html').write_text('previous checkout homepage')
        self.mirror = Path(self.temp.name) / 'mirror'
        self.mirror.mkdir()
        (self.mirror / '1392244.json').write_text(json.dumps({'source': 'eventspy', 'gameId': 1392244}))
        self.ticket = Path(self.temp.name) / 'tickets'
        self.ticket.mkdir()
        self.config = CONFIG
        self.patches = [patch.object(deploy, 'PRODUCTION', self.root), patch.object(deploy, 'MIRROR', self.mirror), patch.object(deploy.os, 'geteuid', return_value=1000)]
        for value in self.patches:
            value.start()
            self.addCleanup(value.stop)
        self.inspect = {
            'Name': '/' + deploy.NAME, 'State': {'Running': True}, 'Image': 'sha256:' + 'a' * 64,
            'Config': {'Image': 'sha256:' + 'a' * 64, 'User': ''},
            'HostConfig': {'NetworkMode': 'seahawksfanzone_default', 'PortBindings': {'80/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '4322'}]},
                           'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}, 'ReadonlyRootfs': False},
            'Mounts': [self.mount(self.root / 'dist', deploy.OLD_HTML), self.mount(self.root / 'nginx/default.conf', deploy.CONFIG_DEST),
                       self.mount(self.mirror, '/srv/eventspy-mirror'), self.mount(self.ticket, '/srv/ticket-data')],
        }
        self.commands = []
        self.build_fails = False
        self.nginx_fails = False
        self.launch_fails = False
        self.old_home = b'the actual homepage pinned inside the old mount'
        self.origins = []

    @staticmethod
    def mount(source, destination):
        return {'Type': 'bind', 'Source': str(source), 'Destination': destination, 'RW': False}

    def fake_run(self, args, capture=True):
        args = list(map(str, args))
        self.commands.append(args)
        if args[0] == 'git':
            return 'git@github.com:caferacerstudios/template-fan-zone.git\n'
        if args[:2] == ['docker', 'inspect']:
            return json.dumps([self.inspect])
        if args[:3] == ['docker', 'exec', deploy.NAME]:
            return self.config if args[3] == 'cat' else ''
        if args[:2] == ['docker', 'cp']:
            (Path(args[-1]) / 'index.html').write_bytes(self.old_home)
            return ''
        if args[0] == 'bash':
            if self.build_fails:
                raise RuntimeError('fixture build failed')
            self.assertEqual(args[-1], '--stage-only')
            stage = self.root / '.team-build/seahawks/dist'
            stage.mkdir(parents=True)
            (stage / 'index.html').write_bytes(NEW_HOME)
            (stage / 'data').mkdir()
            (stage / 'data/news-front-page.json').write_text('{"fixture":true}')
            (self.root / '.team-build/staged-build.json').write_text('{"team":"seahawks"}')
            return ''
        if args[:2] == ['docker', 'run']:
            if '--rm' in args and self.nginx_fails and any('src=' + str(self.root / '.sites-runtime') in part and '/default.conf,' in part for part in args):
                raise RuntimeError('fixture candidate config failed')
            if '-d' in args and self.launch_fails and '--mount' in args and any('dst=/site,readonly' in part for part in args):
                raise RuntimeError('fixture candidate failed to start')
        return ''

    def invoke(self, apply=True, fail_origin=False):
        def origin(expected):
            self.origins.append(expected)
            if fail_origin and expected == NEW_HOME:
                raise RuntimeError('fixture new origin mismatch')
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), patch.object(deploy, 'run', side_effect=self.fake_run), patch.object(deploy, 'verify_origin', side_effect=origin), patch.object(deploy, 'verify_tickets') as tickets, patch.object(deploy.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
            deploy.deploy(self.root, apply)
        return tickets

    def test_config_adds_team_route_preserves_other_directives(self):
        updated = deploy.adapt_config(CONFIG, deploy.OLD_HTML)
        self.assertIn('root /site/dist;', updated)
        self.assertIn('location ^~ /data/eventspy-mirror/seahawks/', updated)
        self.assertIn('location ^~ /data/eventspy-mirror/', updated)
        self.assertEqual(updated.count('alias /srv/eventspy-mirror/;'), 2)
        self.assertIn('https://seahawksfanzone.com$request_uri', updated)
        self.assertIn('alias /srv/ticket-data/current/', updated)
        self.assertEqual(deploy.adapt_config(updated, deploy.NEW_HTML), updated)

    def test_unrendered_active_config_stops(self):
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            deploy.adapt_config(CONFIG.replace('seahawksfanzone', '{team}fanzone'), deploy.OLD_HTML)

    def test_unknown_root_and_alias_stop(self):
        with self.assertRaisesRegex(ValueError, 'one active nginx root'):
            deploy.adapt_config(CONFIG.replace('/usr/share/nginx/html', '/different'), deploy.OLD_HTML)
        with self.assertRaisesRegex(ValueError, 'unrecognized alias'):
            deploy.adapt_config(CONFIG.replace('/srv/eventspy-mirror/;', '/other/;'), deploy.OLD_HTML)

    def test_immutable_image_name_and_mounts_are_preserved(self):
        layout = deploy.inspect_layout(self.root, self.inspect, self.config)
        command = deploy.container_command(layout, self.root, self.root / 'default.conf')
        self.assertIn(self.inspect['Image'], command)
        self.assertIn('--pull=never', command)
        self.assertIn('seahawksfanzone_default', command)
        self.assertIn('unless-stopped', command)
        self.assertIn('0.0.0.0:4322:80/tcp', command)
        self.assertIn('type=bind,src=' + str(self.ticket) + ',dst=/srv/ticket-data,readonly', command)
        self.assertIn('type=bind,src=' + str(self.root) + ',dst=/site,readonly', command)

    def test_wrong_site_and_writable_mount_stop(self):
        self.inspect['Mounts'][0]['Source'] = str(self.root.parent / 'templatefanzone/dist')
        with self.assertRaisesRegex(ValueError, 'does not serve'):
            deploy.inspect_layout(self.root, self.inspect, self.config)
        self.inspect['Mounts'][0]['Source'] = str(self.root / 'dist')
        self.inspect['Mounts'][2]['RW'] = True
        with self.assertRaisesRegex(ValueError, 'read-only bind mounts'):
            deploy.inspect_layout(self.root, self.inspect, self.config)

    def test_compose_matches_image_ports_network_and_mounts(self):
        layout = deploy.inspect_layout(self.root, self.inspect, self.config)
        service = deploy.compose_document(layout, self.root, self.root / 'default.conf')['services']['web']
        self.assertEqual(service['image'], layout['image'])
        self.assertEqual(service['pull_policy'], 'never')
        self.assertEqual(service['network_mode'], 'seahawksfanzone_default')
        self.assertEqual(len(service['volumes']), 4)
        self.assertEqual(service['ports'][0]['published'], '4322')
        self.assertTrue(all(item['read_only'] for item in service['volumes']))

    def test_check_changes_nothing(self):
        self.invoke(apply=False)
        self.assertFalse((self.root / '.sites-runtime').exists())
        self.assertFalse(any(command[:2] in (['docker', 'run'], ['docker', 'stop'], ['docker', 'cp']) or command[0] == 'bash' for command in self.commands))

    def test_build_failure_keeps_original_running_and_dist(self):
        self.build_fails = True
        with self.assertRaisesRegex(RuntimeError, 'build failed'):
            self.invoke()
        self.assertFalse(any(command[:2] == ['docker', 'stop'] for command in self.commands))
        self.assertEqual((self.root / 'dist/index.html').read_text(), 'previous checkout homepage')

    def test_candidate_nginx_failure_is_before_cutover(self):
        self.nginx_fails = True
        with self.assertRaisesRegex(RuntimeError, 'config failed'):
            self.invoke()
        self.assertFalse(any(command[:2] == ['docker', 'stop'] for command in self.commands))
        self.assertEqual((self.root / 'dist/index.html').read_text(), 'previous checkout homepage')

    def test_migration_keeps_served_backup_and_old_container(self):
        tickets = self.invoke()
        self.assertEqual((self.root / 'dist/index.html').read_bytes(), NEW_HOME)
        backup = next((self.root / '.sites-runtime').iterdir())
        self.assertEqual((backup / 'served-dist/index.html').read_bytes(), self.old_home)
        self.assertEqual((backup / 'previous-checkout-dist/index.html').read_text(), 'previous checkout homepage')
        self.assertEqual(json.loads((backup / 'deployment.json').read_text())['status'], 'deployed')
        self.assertTrue(any(command[:2] == ['docker', 'rename'] for command in self.commands))
        self.assertFalse(any(command[:2] == ['docker', 'rm'] for command in self.commands))
        self.assertTrue(any(command[:3] == ['docker', 'update', '--restart=no'] for command in self.commands))
        tickets.assert_called_once()
        self.assertEqual(self.origins, [NEW_HOME])

    def test_failed_new_origin_restores_captured_serving_pages(self):
        with self.assertRaisesRegex(RuntimeError, 'previous serving pages were restored'):
            self.invoke(fail_origin=True)
        self.assertEqual((self.root / 'dist/index.html').read_text(), 'previous checkout homepage')
        self.assertEqual(self.origins, [NEW_HOME, self.old_home])
        launches = [command for command in self.commands if command[:2] == ['docker', 'run'] and '-d' in command]
        self.assertEqual(len(launches), 2)
        self.assertTrue(any('served-dist,dst=/usr/share/nginx/html,readonly' in part for part in launches[-1]))
        self.assertTrue(any('rollback-default.conf,dst=/etc/nginx/conf.d/default.conf,readonly' in part for part in launches[-1]))
        self.assertFalse(any(command[:2] == ['docker', 'start'] for command in self.commands))

    def test_failed_container_start_also_restores_serving_pages(self):
        self.launch_fails = True
        with self.assertRaisesRegex(RuntimeError, 'previous serving pages were restored'):
            self.invoke()
        self.assertEqual(self.origins, [self.old_home])
        self.assertEqual((self.root / 'dist/index.html').read_text(), 'previous checkout homepage')

    def test_already_migrated_updates_without_container_recreation(self):
        self.inspect['Mounts'][0] = self.mount(self.root, '/site')
        self.config = deploy.adapt_config(CONFIG, deploy.OLD_HTML)
        self.old_home = (self.root / 'dist/index.html').read_bytes()
        self.invoke()
        self.assertEqual((self.root / 'dist/index.html').read_bytes(), NEW_HOME)
        self.assertFalse(any(command[:2] in (['docker', 'stop'], ['docker', 'rename']) for command in self.commands))
        self.assertFalse(any(command[:2] == ['docker', 'run'] and '-d' in command for command in self.commands))

    def test_retry_recognizes_its_captured_rollback_mount(self):
        backup = self.root / '.sites-runtime/production-deploy-fixture'
        captured = backup / 'served-dist'
        captured.mkdir(parents=True)
        (backup / 'deployment.json').write_text(json.dumps({'status': 'rolled-back', 'root': str(self.root)}))
        self.inspect['Mounts'][0] = self.mount(captured, deploy.OLD_HTML)
        layout = deploy.inspect_layout(self.root, self.inspect, self.config)
        self.assertFalse(layout['stable'])
        (backup / 'deployment.json').write_text(json.dumps({'status': 'deployed', 'root': str(self.root)}))
        with self.assertRaisesRegex(ValueError, 'matching deployment receipt'):
            deploy.inspect_layout(self.root, self.inspect, self.config)

    def test_route_verifies_game_identity_for_both_prefixes(self):
        response = json.dumps({'source': 'eventspy', 'gameId': 1392244}).encode()
        with patch.object(deploy, 'fetch', return_value=(200, response)) as fetch:
            deploy.verify_tickets()
        self.assertEqual([row.args[0] for row in fetch.call_args_list], ['/data/eventspy-mirror/1392244.json', '/data/eventspy-mirror/seahawks/1392244.json'])
        with patch.object(deploy, 'fetch', return_value=(200, b'{"source":"eventspy","gameId":123}')):
            with self.assertRaisesRegex(ValueError, 'expected Seattle'):
                deploy.verify_tickets()

    def test_publish_failure_restores_original_directory(self):
        stage = self.root / 'stage'
        stage.mkdir()
        backup = self.root / 'previous'
        real = deploy.os.rename
        calls = []
        def rename(source, target):
            calls.append((source, target))
            if source == stage:
                raise OSError('fixture move failed')
            return real(source, target)
        with patch.object(deploy.os, 'rename', side_effect=rename):
            with self.assertRaisesRegex(OSError, 'fixture'):
                deploy.publish_stage(self.root, stage, backup)
        self.assertEqual((self.root / 'dist/index.html').read_text(), 'previous checkout homepage')
        self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main()
