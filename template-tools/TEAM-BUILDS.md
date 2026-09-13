# Team builds from the template

Use the same checkout at `/home/laurawkr/templatefanzone`. The `TEAM` choice selects the team's name, city, style, history, news, NFL snapshot, roster/injury/transaction snapshot, game recaps, and ticket feed.

```bash
cd /home/laurawkr/templatefanzone
bash template-tools/build-team.sh seahawks
bash template-tools/build-team.sh broncos
bash template-tools/build-team.sh packers
bash template-tools/build-team.sh vikings
bash template-tools/build-team.sh chiefs
bash template-tools/build-team.sh patriots
```

Run one command at a time. Each successful command replaces this template's `dist/` and therefore changes the team shown by the existing preview at `http://192.168.88.3:4326/`. No container restart is required for the existing `/site/dist` mount. This does not build the separate production checkout.

The helper reads `config/active-sites.json`, runs `node:22-bookworm` as your user, and mounts that team's snapshot parent directories read-only. Mounting a parent preserves `current` symlinks into immutable snapshot directories. Python 3 and Docker are required; `jq` is not required. Add `--dry-run` to check the inputs and print the resulting Docker command.

Before a new team's first build, run its `refresh_nfl_snapshot_<team>` task in `sfz_nfl_refresh` and wait for success. An authenticated NFL snapshot is required for every new team. A missing, invalid, or mismatched NFL snapshot stops the build before publishing. Seattle retains the existing repository-data fallback only when its NFL directory is not mounted.

The daily article tasks and game recap tasks publish separate collections. A new team can build before its first daily article or recap task; those sections remain empty. Once the corresponding snapshot exists, the next build imports it. Invalid files, checksum mismatches, broken `current` links, and conflicting team identities fail the build. Legacy Seattle recap manifests without a team tag remain supported; new-team manifests must identify their team.

| Team | NFL snapshot | Recap snapshot |
| --- | --- | --- |
| Seahawks | `/var/lib/sfz-nfl/current` | `/var/lib/sfz-recaps/current` |
| Broncos | `/var/lib/boncosfz-nfl/current` | `/var/lib/boncosfz-recaps/current` |
| Packers | `/var/lib/packersfz-nfl/current` | `/var/lib/packersfz-recaps/current` |
| Vikings | `/var/lib/vikingsfz-nfl/current` | `/var/lib/vikingsfz-recaps/current` |
| Chiefs | `/var/lib/chiefsfz-nfl/current` | `/var/lib/chiefsfz-recaps/current` |
| Patriots | `/var/lib/patriotsfz-nfl/current` | `/var/lib/patriotsfz-recaps/current` |

The build imports complete team NFL snapshots before rendering pages. Its refreshed schedule also binds the reviewed EventSpy coverage; an older standalone ticket schedule cannot replace newer NFL game status. Standings use the selected division: NFC West for Seattle, AFC West for Denver and Kansas City, NFC North for Green Bay and Minnesota, and AFC East for New England. Opponent names and IDs remain literal data.

Current rosters and historical player statistics are separate. The `sfz_roster_refresh` DAG's `refresh_roster_<team>` tasks publish the official roster, injury reports, and transactions. Their collection path derives from `news_snapshot_dir` by replacing `-news/current` with `-roster/current` (for example `/var/lib/boncosfz-roster/current`). The helper mounts this parent read-only when it exists. Build after the task succeeds to import the new roster.

Roster import runs after EventSpy/NFL imports so selected official membership is retained. It leaves historical statistical totals and their season unchanged. Before the first roster snapshot, Seattle retains its checked-in roster and updates; other teams show empty roster/update sections. A present invalid snapshot or broken link stops publication. See [roster-airflow.md](../docs/roster-airflow.md) for the contract and freshness behavior. The provider's historical player directory is never promoted into current membership.

Game-day and viewing guide snapshots are a separate, optional input. After the
guide DAG succeeds, use `FAN_ZONE_GUIDES_ENABLED=1` in the preview checkout to
import that team's `-guides/current` collection. The default is off. A first test
with `--stage-only` keeps served `dist/` intact. See
[game-guides-airflow.md](../docs/game-guides-airflow.md) for the contract, validation,
per-record freshness, and production adoption boundary.

Only the selected team's history, style, and content are emitted. Other team history files remain build inputs outside the published website. Game opponents can naturally appear in schedules, standings, and sourced history.

A successful build stages its complete output before swapping `dist/`. A build or data-validation failure keeps the previous preview available.

## Patriots onboarding

Patriots uses New England, NE, balldontlie ID 1, a navy/red/silver theme, its own favicon and sourced history. Its checked-in entry starts disabled to prevent scheduling before the host is prepared. Explicit builds still work while scheduling is disabled, once valid Patriots NFL data is available. Follow `docs/patriots-onboarding.md` in `homelab-airflow` for the additive host registration and live Variable merge. Do not replace the other active-site entries or rerun the original EventSpy ownership-handoff installer.

Start with `bash template-tools/build-team.sh patriots --stage-only`. The normal command replaces this one preview; it does not create public hosting. The default canonical is `https://patriotsfanzone.com`, which must be confirmed before public deployment.

The Patriots EventSpy manifest has 17 regular-season matchups, four reviewed URLs (including the completed opener), and 13 explicitly unavailable pages. Only three reviewed games remain in the future at the September 13 review. The actual preview needs the new read-only Patriots ticket bind and nginx alias before those live prices can be served. Add Patriots photos under `/var/lib/patriotsfz-news/photos` with matching approved photo credits; an empty bucket uses the existing neutral fallback.
