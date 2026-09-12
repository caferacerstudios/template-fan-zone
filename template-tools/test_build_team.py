import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('build_team', Path(__file__).with_name('build-team.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BuildCommandTests(unittest.TestCase):
    def test_parent_mounts_preserve_current_links_and_team_is_explicit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / 'runtime/broncos-nfl/current'
            snapshot = current.parent / 'snapshots/one'
            snapshot.mkdir(parents=True)
            current.symlink_to('snapshots/one')
            news = root / 'runtime/broncos-news'
            news.mkdir()
            recap = root / 'runtime/broncos-recaps'
            recap.mkdir()
            config = root / 'config/active-sites.json'
            config.parent.mkdir()
            config.write_text(json.dumps({'broncos': {'nfl_snapshot_dir': str(current), 'news_snapshot_dir': str(news / 'current'), 'recap_snapshot_dir': str(recap / 'current'), 'eventspy': {'schedule_file': str(root / 'schedules/broncos.json')}}}))
            command = module.build_command(root, 'broncos')
            self.assertIn('TEAM=broncos', command)
            self.assertIn(f'type=bind,src={current.parent},dst={current.parent},readonly', command)
            self.assertNotIn(f'type=bind,src={current},dst={current},readonly', command)
            self.assertEqual(command[-4:], ['node:22-bookworm', 'npm', 'run', 'build'])

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
