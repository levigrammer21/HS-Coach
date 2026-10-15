# HS Football — Coach's Box

A mobile-first, GitHub Pages compatible football coaching game prototype built around autonomous 22-player play execution, a touch route editor, four weighted automatic defensive calls, eight contrasting fictional schools, local franchise progression, and Firebase-backed asynchronous friend invites.

## Run

All files live at the repository root. Upload `index.html`, `style.css`, `app.js`, `data.js`, `engine.js`, `firebase.js` and `firestore.rules` to a GitHub repository. In GitHub Settings → Pages, deploy from your main branch root. No build tools are needed. For local testing, serve the folder over HTTP (e.g. `python -m http.server 8000`) rather than opening `file://`.

In Firebase Console for project `hs-football-gm`:
1. Enable Authentication → Sign-in method → **Anonymous**.
2. Create a Firestore database if needed.
3. Publish the contents of `firestore.rules` in Firestore → Rules. These rules only cover new `hsfUsers` and `hsfMatches` collections; check other existing rules before replacing them. **Do not delete existing data.**
4. Add your GitHub Pages domain to Firebase Authentication authorized domains.

The supplied Firebase web configuration is public-client configuration, not an admin credential.

## What works

- Canvas-based real-time spatial simulation of 22 moving players, run/pass selection, simplified pursuit, blocking, catches and tackles, plus replay.
- Five offensive starter plays, touch formation/route editing, QB read order and saved playbooks (localStorage).
- Four defensive calls with configurable weighted frequencies, plus additional custom call names and broad types.
- Eight fictional schools with distinct strengths, generated individual rosters and local multi-week franchise progression.
- Firestore invite-code games with asynchronous offensive play submissions and automated opponent defense.
- Mobile-first controls, responsive layouts, local persistence and static GitHub Pages deployment.

## Important limitations

**This is not yet the complete high-fidelity football game envisioned in the design conversation.** The simulation is simplified: no comprehensive NFHS rules, penalty system, real special teams, full season schedule/playoffs, physical blocking and tackling animations, sophisticated QB read AI, defensive spatial editor, conditional assignment logic, two-way player substitutions, true 2.5D broadcast camera, or deterministic shared replay playback across clients. The graphics use procedural block athletes, not a finished sprite animation set. Franchise week advancement currently simulates a result from roster strength rather than playing a scheduled game. Multiplayer records the selected play and result but does not replay the full shared timeline for the other coach. Firestore multiplayer is designed for a trusted small friend group and is not hardened against conflicting simultaneous updates.

**Don't present this as a finished one-shot game.** It is a functional code foundation with explicit unfinished features.

## Persistence and security

Local saves are stored in browser localStorage and are not automatically synchronized across devices. Friend matches live in `hsfMatches`, profiles in `hsfUsers`. Firestore security rules must be published separately and should be reviewed before use. Client-driven multiplayer is deliberately trust-based. Firebase Cloud Functions are not required for this foundation.
