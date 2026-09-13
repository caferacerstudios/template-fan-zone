import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('build_team', Path(__file__).with_name('build-team.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BuildCommandTests(unittest.TestCase):
    def test_patriots_config_uses_its_own_parent_mounts_and_can_stage_without_publishing(self):
        configured = json.loads((module.ROOT / 'config/active-sites.json').read_text())['patriots']
        self.assertEqual((configured['name'], configured['city'], configured['abbreviation'], configured['balldontlie_team_id']),
                         ('Patriots', 'New England', 'NE', 1))
        with tempfile.TemporaryDirectory() as temporary, patch.dict('os.environ', {}, clear=True):
            root = Path(temporary)
            site = dict(configured)
            for key in ('nfl_snapshot_dir', 'news_snapshot_dir', 'recap_snapshot_dir'):
                current = root / Path(site[key]).relative_to('/var/lib')
                snapshot = current.parent / 'runs/one/snapshot'
                snapshot.mkdir(parents=True)
                current.symlink_to('runs/one/snapshot')
                site[key] = str(current)
            roster = Path(site['news_snapshot_dir'].replace('-news/current', '-roster'))
            roster.mkdir()
            site['eventspy'] = {**site['eventspy'], 'schedule_file': str(root / 'schedules/patriots.json')}
            (root / 'schedules').mkdir()
            config = root / 'config/active-sites.json'
            config.parent.mkdir()
            config.write_text(json.dumps({'patriots': site}))
            command = module.build_command(root, 'patriots', stage_only=True)
            self.assertIn('TEAM=patriots', command)
            self.assertIn('FANZONE_STAGE_ONLY=1', command)
            for directory in [Path(site[key]).parent for key in ('nfl_snapshot_dir', 'news_snapshot_dir', 'recap_snapshot_dir')] + [roster]:
                self.assertIn(f'type=bind,src={directory},dst={directory},readonly', command)
            self.assertNotIn('TEAM=seahawks', command)
        help_result = subprocess.run([sys.executable, str(Path(module.__file__)), '--help'], text=True, capture_output=True, check=True)
        self.assertIn('patriots', help_result.stdout)

    def test_parent_mounts_preserve_current_links_and_team_is_explicit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / 'runtime/broncos-nfl/current'
            snapshot = current.parent / 'snapshots/one'
            snapshot.mkdir(parents=True)
            current.symlink_to('snapshots/one')
            news = root / 'runtime/broncos-news'
            news.mkdir()
            roster = root / 'runtime/broncos-roster'
            roster.mkdir()
            recap = root / 'runtime/broncos-recaps'
            recap.mkdir()
            config = root / 'config/active-sites.json'
            config.parent.mkdir()
            config.write_text(json.dumps({'broncos': {'nfl_snapshot_dir': str(current), 'news_snapshot_dir': str(news / 'current'), 'recap_snapshot_dir': str(recap / 'current'), 'eventspy': {'schedule_file': str(root / 'schedules/broncos.json')}}}))
            command = module.build_command(root, 'broncos')
            self.assertIn('TEAM=broncos', command)
            self.assertIn(f'type=bind,src={current.parent},dst={current.parent},readonly', command)
            self.assertNotIn(f'type=bind,src={current},dst={current},readonly', command)
            self.assertIn(f'type=bind,src={roster},dst={roster},readonly', command)
            self.assertEqual(command[-4:], ['node:22-bookworm', 'npm', 'run', 'build'])

    def test_guides_mount_only_after_opt_in_and_keep_stage_only(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict('os.environ', {}, clear=True):
            root = Path(temporary)
            for name in ('broncos-nfl', 'broncos-news', 'broncos-recaps', 'broncos-guides'):
                (root / name / 'current').mkdir(parents=True)
            config = root / 'config/active-sites.json'
            config.parent.mkdir()
            config.write_text(json.dumps({'broncos': {
                'nfl_snapshot_dir': str(root / 'broncos-nfl/current'),
                'news_snapshot_dir': str(root / 'broncos-news/current'),
                'recap_snapshot_dir': str(root / 'broncos-recaps/current'),
                'eventspy': {'schedule_file': str(root / 'schedules/broncos.json')},
            }}))
            mount = f'type=bind,src={root / "broncos-guides"},dst={root / "broncos-guides"},readonly'
            self.assertNotIn(mount, module.build_command(root, 'broncos'))
            (root / '.env').write_text('OPENAI_API_KEY=never-forward\nexport FAN_ZONE_GUIDES_ENABLED="1" # preview\n')
            command = module.build_command(root, 'broncos', stage_only=True)
            self.assertIn(mount, command)
            self.assertIn('FAN_ZONE_GUIDES_ENABLED=1', command)
            self.assertIn('FANZONE_STAGE_ONLY=1', command)
            self.assertNotIn('never-forward', ' '.join(command))
            with patch.dict('os.environ', {'FAN_ZONE_GUIDES_ENABLED': '0'}):
                command = module.build_command(root, 'broncos')
                self.assertNotIn(mount, command)
                self.assertIn('FAN_ZONE_GUIDES_ENABLED=0', command)
            (root / 'broncos-guides/current').rmdir()
            with self.assertRaisesRegex(ValueError, 'Missing guide snapshot'):
                module.build_command(root, 'broncos')

    def test_new_team_requires_nfl_snapshot_before_docker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'config/active-sites.json'
            config.parent.mkdir()
            config.write_text(json.dumps({'packers': {'nfl_snapshot_dir': str(root / 'missing/current')}}))
            with self.assertRaisesRegex(ValueError, 'refresh_nfl_snapshot_packers'):
                module.build_command(root, 'packers')


if __name__ == '__main__':
    unittest.main()
