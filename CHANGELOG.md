# Version 1.2.0

- Fixed delayed run exchanges accidentally entering pass progressions, legal own-end-zone quarterback movement and short-field alignment. Added stamina-dependent active fatigue, bench recovery and independent athlete identities when friends choose the same school.

- Preserved the approved broadcast field, original uniforms and movement style. Reduced overlay label clutter; added momentum lean and a short throw follow-through.
- Corrected protection mapping: tackles take the edge instead of crossing guards behind them. Zone blocking uses the same lane discipline. Added receiver stalk blocks after an exchange, defensive shedding/recovery, visible running-lane decisions and improved pursuit meeting points.
- Split underneath coverage into real sectors; fixed the Cover 3 strong-safety landmark. Man defenders react to delayed observed movement; the AI never inspects a receiver's future path. Throws respect arm range.
- Implemented real backward-pitch flight, catches and loose-ball recovery for toss/triple option. The read edge remains unblocked; a contain assignment can force a give. Custom mesh timing and QB keep paths work in the designer.
- Replaced the old kick routine with fixed-step dedicated 22-athlete units, protection, kick blocks, returns, physical onside recoveries, directional punts, fair catches, goal-plane scoring and touchbacks.
- Improved late-game CPU tempo, spike/kneel decisions, fourth-down field-goal range and urgency. End games on winning last-second or second-possession overtime touchdowns without unnecessary tries.
- Added event-based coach film notes, live decision text, persistent Field View, larger film touch controls and recoverable local designer drafts. Failed saves no longer report a successful install.
- Preserved legal line-number pools through graduation. Factory upgrades preserve edited plays, defensive tendencies and saved profiles.
- Simplified multiplayer rules to account privacy, turn ownership and sequential writes; removed expensive whole-roster comparisons. Basic retry/replay reliability remains. No competitive anti-cheat infrastructure.
- Versioned the offline shell as a complete bundle so cached and fresh simulation modules are not mixed.

# HS Football 1.1 — Expanded Coach’s Box

The approved stadium, uniforms, angled field, mobile menus and athlete style are retained.

## On the field

- Pre-snap play art is visible immediately: route arrows, runner paths, blocking bars, motion/shift dashes and numbered QB progression.
- Animated shifts, a set interval, lateral motion and defenders following observed motion before the snap.
- Catch poses, pass deflections/interceptions in flight, tackle/fall/ground/get-up replay states and touchdown celebration.
- Correct three-, two- and one-deep shells for Cover 3, Cover 2 and Cover 1.
- Stable protection matchups, combined double-team force, climbs to linebackers, pulling/lead-block engagement and actual mesh positioning.
- Quarterback escape logic ignores engaged rushers and executes the scramble path. Option reads select the intended side’s defender.
- Corrected inward slants and mesh crossers, plus reworked power/counter/dive personnel and responsibilities.
- Height affects pass reach; size contributes to line contact; fatigue still changes athlete selection and performance.
- Periods expiring before the snap do not animate or count a phantom play. Accepted live-ball penalties can create an untimed down; some penalties are automatically declined when the result is preferable.

## Coaching tools

- Named playbooks, switching, copying, renaming and formation/concept/tag search.
- Eight formation templates, four defensive-front templates and saved custom formations.
- Touch drawing plus numeric path-point editing, rounded route transitions, undo/redo, motion/shifts and delayed/event-start routes.
- Conditional QB rules using actual pressure, defender crash, separation, following motion, overload, open window and elapsed time.
- Pre-snap mirrored calls, protection adjustments, read order and hot receivers.
- Depth charts with two-way starters and fatigue rotation; the feature RB is selected before an automatic fullback.
- Opponent scouting, configurable practice situations, a chosen practice defense and a twenty-snap simulation study.

## Program and film

- Detailed passing, rushing, receiving, defensive, blocking and kicking game statistics.
- Quarter scoring, third/fourth-down production, possession summaries and archived game box scores.
- Season leaders, career totals, individual development emphasis and graduating-athlete records.
- Incoming classes preserve the positions lost to graduation.
- Up to 1,000 local film entries, duplicate suppression, old-film cleanup and individual film export. Friend-game films remain server-backed.

## Saves and multiplayer

- Correct Firestore encoding for nested playbook/route/score arrays; compressed profiles and replays.
- Atomic turn/replay writes, concurrent duplicate reconciliation and pending-turn retry/discard controls.
- Automatic signed-in profile backups after initial account synchronization, with revision checks that stop conflicting overwrites.
- Same-browser authentication persistence; fresh-device cloud restoration and manual backup/import controls.
- An isolated Firebase emulator suite exercises two coaches, access rules, actual client transactions, a full regulation game, shared films, standings and interrupted-transport recovery.

## Compatibility

- Device save database and Firebase namespace remain unchanged.
- Unmodified factory installs are upgraded; customized installs are retained.
- Local games continue under the new engine. Stored replay positions remain viewable.
- New friend matches use `hsf-1.1.0`. Older engine matches should be viewed as historical film and replaced with a new matchup.
- Merge the updated namespace rules before creating a new 1.1 friend game.
