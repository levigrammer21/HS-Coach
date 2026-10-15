# HS Football — The Coach’s Box

Fresh-source, mobile-first football coordinator game. No earlier HS Football code or assets were used.

**Read IMPLEMENTATION.md before treating this as the fully finished handoff specification.** This delivery contains a playable integrated game, but does not fully achieve every requested simulation, animation, rules, and multiplayer-verification requirement. No live deployment or authenticated Firebase acceptance test has been performed.

## Publish from your phone — no build required

1. Extract the ZIP. It contains one folder named `HS-Football`.
2. Create a **new** GitHub repository, or select the exact repository you intend to use. These files have not been pushed to any existing repository.
3. Upload the **contents** of `HS-Football` directly into the repository root. `index.html`, `app.js`, and `style.css` must be at the top level, rather than inside another `HS-Football` folder. GitHub’s mobile website may require “Desktop site” for Add file → Upload files. A phone Git client can also upload the folder contents.
4. Open repository Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.
5. Open the URL GitHub provides, usually `https://YOUR-USERNAME.github.io/REPOSITORY/`.
6. Local exhibitions, practice, the designer, film, and franchise work without Firebase sign-in. The first visit requires a connection; the service worker caches local game files afterward.
7. For friend games, complete the Firebase steps below.

There is no frontend build step, no runtime npm dependency, no Node server, and no API secret to enter. All game code is at the root. The only nested project file is GitHub’s optional automated-check workflow.

## Existing Firebase project

Project: **hs-football-gm**. The supplied public web configuration is already in `firebase-config.js`. It is not an administrative credential.

Read-only observations during development:

- Firebase Authentication’s public project configuration was reachable.
- Its authorized-domain response included `levigrammer21.github.io`, `localhost`, `hs-football-gm.firebaseapp.com`, and `hs-football-gm.web.app`.
- The default Firestore endpoint was reachable and returned `PERMISSION_DENIED` for unauthenticated access to the new game namespace. That does **not** verify the game’s signed-in rules, provider settings, or transaction behavior.
- The pinned Firebase browser SDK URL returned HTTP 200.

No Firebase account was created, no rule was deployed, and no document was changed during development. Existing collections were not read or modified.

### Authentication

In Firebase Console → `hs-football-gm` → Authentication:

1. Check Sign-in method. Enable **Email/Password** if it is not enabled.
2. Optionally enable **Google**, including a support email. Google popup sign-in is implemented; email/password is the fallback for mobile popup restrictions.
3. Under Settings → Authorized domains, confirm the hostname serving the game. For GitHub Pages this is `YOUR-USERNAME.github.io`, without a path or protocol. The observed Levi hostname is already present, but recheck if using another account or domain.

The client uses Firebase local authentication persistence. Refreshing should retain the account in the same browser/app storage context. A separate browser or installed app may use a separate storage context.

### Firestore — merge, do not replace existing rules

The game uses only this new namespace:

```text
hsFootballV1/app/coaches/{uid}/saves/main
hsFootballV1/app/games/{joinCode}
hsFootballV1/app/games/{joinCode}/snaps/{sequence}
```

1. Open Firestore Database → Rules. Copy your current complete rules somewhere safe.
2. Open `firestore.rules` from this project.
3. Merge **only the `match /hsFootballV1/app { ... }` block** into your existing `match /databases/{database}/documents { ... }` block.
4. Preserve all existing collection matches and other application behavior. Do not paste a second outer `service cloud.firestore` declaration into the current file.
5. Check whether any existing broad wildcard permits writes into the new namespace. Firestore allow rules are additive: an older permissive wildcard can bypass the protections in the new block. Narrow that old rule only after reviewing its existing application requirements.
6. Use Firebase’s rules editor validation and publish the merged rules.

Do **not** run a blanket `firebase deploy --only firestore:rules` with the supplied file against this reused project: it contains the new game namespace only, not your previous applications’ rules. `firebase.json` and `.firebaserc` identify the intended project for an informed developer; they are not a command to replace your rules.

The current queries use a single array-contains filter for your matches and a single equality filter for completed matches; they require no custom composite index. Storage, Cloud Functions, Analytics, and billing upgrades are not required by this implementation.

## Playing

- **Home:** choose an official school and start or resume an exhibition.
- **Gameday:** choose your call, set tempo or adjustments, snap, then watch. When the opponent has possession, “Watch opponent snap” runs its CPU-selected offense against your saved automatic defense. There is no joystick control.
- **Playbook:** create or edit alignments, drag athletes, draw routes, choose route templates, assign blocks, draw motion or shifts, set delays/events and quarterback reads. Save or duplicate installs; save/load custom formations; export/import playbooks.
- **Practice:** use “Test in practice” inside an offensive install. The field resets after each snap. The selected unsaved install is used for practice.
- **Defense:** set frequency weights, create defensive fronts, zones, man targets, run fits, stunts and contain responsibilities. Zero excludes ordinary selection; a legal Cover 3 fallback is used if no call is eligible.
- **Team fit:** compares all eight rosters with your book. It does not change athlete ratings or apply a performance multiplier.
- **Program:** play or simulate weeks, edit remaining opponents/venues, customize school colors and rules, edit athlete ratings, advance through a four-school playoff, and start the next year with development, graduation, and incoming freshmen.
- **Roster:** inspect all 44 athletes per official school. Toggle to your franchise roster for editing.
- **Film:** review up to 100 indexed local snaps; pause, scrub, change speed, show paths/coverage landmarks, and tap decision events. Tap an athlete on the broadcast field to identify him.

### Friend games

1. Both coaches sign in through Friends.
2. Creator chooses an official school and selects Create friend game.
3. Share the displayed join code using your normal messaging app.
4. Friend selects Join with code and chooses a school. Both may choose the same school; the renderer uses dark/white uniforms to distinguish sides.
5. The current coach opens the game, runs an offensive or special-teams turn, and watches the result. The defense is automatically selected and executed.
6. When possession changes, the other coach takes the offensive turn. There is no defensive turn requirement.
7. Use Refresh games to check waiting turns. An open game uses a live snapshot listener. There are no push/email notifications.

The offensive and defensive playbooks are copied into the match at creation/joining. Defensive settings and official roster ratings are locked for that match. Pre-snap offensive adjustments affect the next snap. Shared films contain sampled positions, decision events, seed and engine version; clients display the stored film rather than independently rerolling it.

A transaction writes the next game state and immutable snap together. Sequence and actor checks prevent accidental stale/duplicate processing. Failed attempts remain in a local pending slot and are retried on sign-in/reconnection. Transactions require connectivity; the UI reports errors rather than silently claiming that an offline turn was submitted.

**Live acceptance check still required:** with two real accounts, create/join a game, submit from two tabs, disconnect during submission, reconnect, check the replay and sequence, change possession, finish the game, and verify the leaderboard. The included pure transaction tests do not replace this check.

## Saves and recovery

- Playbooks, franchise, current local game, settings and films use IndexedDB, not temporary JavaScript memory.
- Signing in does not automatically overwrite your device save. Use Friends → **Cloud backup** to upload your current profile and **Restore cloud backup** to retrieve it on another device.
- Use Settings → **Export full backup** for a portable JSON backup of playbooks, franchise, settings and current local game.
- Film bytes stay on their originating device. Profile backups do not bundle local films. Friend-game films are separately retained in Firestore.
- Do not clear browser/app storage without making a backup. A different browser or installed app may have its own local saves.
- Updates use a network-first service worker. Close and reopen the game after uploading a changed source version if the prior worker remains active.

## Source map

| File | Responsibility |
| --- | --- |
| `data.js` | Seeded utilities, eight 44-athlete rosters, plays, defenses, legality, fit and lineup selection |
| `engine.js` | 30 Hz scrimmage simulation, decisions, movement, blocks, ball flight, catches and tackles |
| `rules.js` | Game state, clock, down/distance, possession, scoring, special teams, CPU offense and overtime |
| `render.js` | Original Canvas stadium, angled projection, athletes and replay interpolation |
| `app.js` / `style.css` | Responsive screens, touch designer, game controls and navigation |
| `franchise.js` | Schedule, standings, playoffs, records, development and class turnover |
| `sync.js` | Testable friend join and turn validation |
| `cloud.js` | Firebase Authentication, saves, games, transactions, films and derived standings |
| `storage.js` | Transaction-completion-aware IndexedDB reads and writes |
| `sim-worker.js` | Simulation and district-week work off the UI thread |
| `tests.mjs` | Football, franchise, deterministic replay and turn validation tests |
| `test-ui.mjs` | DOM interaction smoke checks, including touch route drawing and persistence |
| `.github/workflows/check.yml` | Optional CI; validates source and runs tests |

## Automated checks

For a development environment with Node 22+:

```sh
npm ci --ignore-scripts
npm run check
```

This is **not required to publish or play**. The optional dependency `happy-dom` is for tests only. Do not upload `node_modules` to GitHub Pages.

The CI workflow runs on a push, pull request, or manual invocation when committed. GitHub Pages publication still uses Settings → Pages → branch/root; no deployment workflow is required.

## Verification limits

The exact check results and substantive gaps are in `IMPLEMENTATION.md`. Browser layout/touch performance on a real phone, live authenticated Firestore behavior, deployed rules, Google provider configuration, and a complete NFHS officiating implementation are not verified or claimed complete.
