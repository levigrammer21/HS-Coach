# HS Football 1.2 — Implementation and verification

This upgrade extends the approved first delivery. It retains its visual direction and original procedural artwork. See CHANGELOG.md for the additions.

## Architecture and behavior

The scrimmage simulation runs at 30 Hz in a worker. Canvas rendering interpolates sampled positions independently. A seeded play includes all 22 athletes, pre-snap motion/shift frames, live movement and ball flight, decision events and post-whistle animation. The result comes from positions, assignments and local interactions; there is no yardage-outcome table and no team-fit performance bonus.

Movement uses acceleration, agility, speed and fatigue. Blocking uses responsibility mapping, approach paths and local technique/strength/size encounters; adjacent blockers can combine and a successful designated double can climb. Defenders execute man targets, landmarks, rush paths, fits and contain responsibilities. Quarterbacks use progression order, timing, awareness, observed pressure and conditional rules. Receiver options use observable leverage and tracking. Throws lead the receiver’s path; nearby defenders can affect a reachable ball in flight. Local catch and tackle contests retain seeded randomness.

The rules layer handles a full game: downs and a fixed line to gain, possession changes, scores/tries, kickoffs, punts, field goals/PATs, safeties, quarter/halftime transitions, clock stops and selected tempo, timeouts, paired overtime and supported penalties. It checks formation geometry and line numbering, handles half-distance, grounding/loss of down, some decline decisions and an untimed down after an eligible accepted foul.

Franchise games and district games use the same engine. The program stores schedules, standings, playoffs, season totals, career totals, historical box scores, training choices, graduating athletes and position-matched incoming classes. Depth charts and explicit athlete assignments allow two-way starters without duplicating an athlete within a unit. Active players accumulate stamina-dependent fatigue, the bench recovers, and quarter/halftime/timeout rest matters. Identical official schools get independent match athlete identities so one coach’s fatigue cannot affect the other’s roster.

Device data uses IndexedDB. Friend games use the existing `hsFootballV1/app` namespace. Turn and membership fields remain queryable; large roster/book/stat/history trees are packed as JSON leaves and nested arrays are wrapped reversibly for Firestore. This avoids expanding thousands of rules-map nodes per turn. Profiles and film payloads use gzip when supported. Turns and immutable films commit atomically. A client retry reconciles an already committed matching turn. Profile revisions prevent an automatic backup from overwriting a changed remote profile.

## Verification performed

The package contains reproducible checks, not just a statement that simulations ran:

- **63 Node tests** cover rosters, formations, defenses, weighted selection, replay determinism, changed assignments, full-game flow, season/playoff progression, graduation, schedule editing, motion, play art, conditional logic, route curves, depth selection, compression, array encoding, migration and regression fixes.
- **58 DOM interaction transitions** exercise touch route drawing, edit/save, named books, conditional rules, formation/front templates, depth charts, scouting, schedule changes, rating edits, practice studies, game/film controls and persistence. Canvas and browser APIs are mocked in this layer.
- **19 Firebase emulator integration checks** use the actual Firestore client and supplied rules with two authenticated test identities. They cover create/join, a rejected third coach, unauthorized access, simultaneous duplicate submissions, immutable replay reads, turn ownership, private profiles, revision conflicts, a full four-quarter regulation game, completed-game rankings and retry after an injected connection failure.
- Final multiplayer turn count and serialized match size are recorded in `VALIDATION.txt`. No production game was created by these tests.
- The extended validation ran eight full regulation matchups, three seasons including playoffs/development/graduation, and 176 default-concept/official-roster combinations. Results are in `VALIDATION.txt`; they establish completion and finite state, not equal team strength.
- Actual Canvas output at a 390×330 logical field size was rendered and visually inspected for the approved athlete style and new play art.

`VALIDATION.txt` contains the final run results. `npm run check` runs engine/DOM checks; `npm run test:firebase` starts an isolated demo emulator and runs the Firebase checks. Neither command needs or uses live project administration credentials.

## Concrete verification limits

- Firebase **production** rules have not been deployed or merged by this assistant. Live Google/email authentication and a real two-device game remain environment acceptance checks. The emulator mocks authentication identities; it does not test the Google provider’s browser popup.
- The supported browser-control capability was unavailable. DOM testing and Canvas inspection do not establish actual phone/iPad layout, touch capture, installation behavior, frame rate, service-worker update behavior or physical network-loss behavior. The recovery test injects a transport failure; it is not an airplane-mode device test.
- This remains a football simulation model, not a complete NFHS officiating implementation. It does not cover every rare foul, numbering/scrimmage-kick exception, state adoption, kick/fumble enforcement nuance or officiating discretion. Supported state options cover timing and overtime; the play clock uses selected game-time tempo so asynchronous coaches are not penalized for being offline.
- Blocking techniques and coverage decisions use shared computational primitives. They are deeper than the first delivery, but do not model every real coaching technique, hand placement, footwork detail or coverage-match system. Triple option and toss pitches now use a live backward ball flight. Dedicated special-team units execute physical protection, coverage, onside recoveries and kick blocks. These remain computational football models; there are no fake kicks or every unusual kicking-game enforcement exception.
- The extended suite now includes three consecutive seasons and all eight rosters. Wider gameplay balance and performance on the user’s hardware remain playtesting tasks. Full games and seasons completing is not evidence that every concept is equally effective or every matchup is balanced. Plays can fail because of assignments and personnel. The engine’s longest-live-play cap remains 22 seconds.
- Local film retention is 1,000 entries. Export important individual films. Device/cloud profile backups do not bundle local film bytes; friend-game films are stored separately in Firestore. In-app turn indicators are implemented; push notifications and tournaments are not.

These limits are retained explicitly rather than describing the package as exhaustive fulfillment of every item in the original handoff.

## Version 1.2 mechanics

Running calls cannot enter the passing progression before a delayed handoff. A quarterback can operate in his own end zone; a safety requires a dead ball there or crossing the end line. Short-field coverage compresses within the end line. CPU coaches use roster scheme, situation, urgency and their own recent play results.

Fan protection maps tackles to edge threats and guards to inside threats. Explicit custom defender targets still take precedence. Run lanes preserve the designed lateral/counter track before the runner selects visible open grass. Unblocked option edges can key the dive fake before reacting to the keep; the actual edge movement and ratings decide the read. Live backward pitches have a carrier-free flight interval and can hit the ground. Zone coverage uses current positions/velocity in sectors, and man coverage uses delayed observation rather than future route points.

The kick module uses 30 Hz movement and local protection, block and tackle encounters. A seeded kick trajectory determines goal-plane height/width or its landing point; the coverage and return players then interact on the field. Recoveries depend on legal eligibility, actual distance and arrival. No success-percentage result is selected before those interactions.

Account rules keep access and sequence ownership, while the app locks the saved roster/defense configuration. This private-friends design deliberately has no competitive anti-cheat system. The installed offline shell caches a complete version together. Local drafts protect interrupted play-design sessions independently of saved installs.

## References consulted

- [NFHS 2019 formation and 40-second play-clock changes](https://www.nfhs.org/resources/sports/football-rules-changes-2019)
- [NFHS 2023 changes, including the grounding exception](https://www.nfhs.org/resources/sports/football-rules-changes-2023)
- [NFHS officials’ points of emphasis, including first-down clock restart](https://nfhs.org/resources/sports/football-game-officials-manual-points-of-emphasis-2024-2025)
- [NFHS rules resources](https://nfhs.org/sports/football/rules)
- [IHSAA NFHS/NCAA comparison](https://www.iahsaa.org/wp-content/uploads/2022/08/NFHS-vs-NCAA-rules-2022.pdf)
- [Firebase transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firebase rules emulator tests](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [Firebase web setup](https://firebase.google.com/docs/web/setup)
- [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)

The complete NFHS rulebook was not available in this session. The reference presentation at [Two-Minute Drill](https://nfl2mindrill.com/) informed the initial field/control direction; no proprietary game code or artwork was incorporated.

Additional kicking references: [NFHS kicking-game guidance](https://assets.nfhs.org/umbraco/media/5393611/officials_22.pdf), [NFHS pop-up kick definition](https://nfhs.org/stories/new-blocking-kicking-rules-address-risk-minimization-in-high-school-football).
