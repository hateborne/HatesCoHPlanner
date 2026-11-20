# Versions and releases

How a deploy picks, tags and stamps a version, which changes make a new one, and how the players'
changelog feeds its notes. The bump rules are in `AGENTS.md`.

Every deploy that changes the site is a release with a SemVer version, `vX.Y.Z`. The first public
release (the site as deployed on November 13, 2026) is `v1.0.0`. The owner's rules for the bump:

- **major**: massive feature changes or redesigns;
- **minor**: a new server, or medium-sized work;
- **patch**: fixes and small changes;
- **none**: a change to nothing the site is built from (below).

When you hand back a pull request, say which bump it calls for, so the owner can pick it at deploy.

- The git tags are the record. `package.json`'s `version` is not used.
- The deploy picks the version (`scripts/release-version.mjs`): the newest `vX.Y.Z` tag, bumped as
  picked. It refuses to run without a bump, and refuses before any version tag exists. A commit that
  already carries a version deploys again under it, with no new tag (re-running an older release's
  deploy puts that release back live on GitHub Pages; the site's own domain goes back by hand only,
  `docs/hosting.md`). A new version goes only to main's newest commit, so re-running
  an old deploy that failed before it was tagged is refused once main has moved on: start a new one.
- A deploy of changes the site is not built from keeps the newest version, whatever bump was picked:
  no new tag, no release, the same number in the footer (next section).
- The build gets the version from `HCP_VERSION` and the commit from `HCP_COMMIT`
  (`vite.config.ts`, read through `src/version.ts`). Builds outside a deploy (dev server, tests,
  pull request checks) are `dev`.
- Before the site goes live, the deploy's `release` job tags the commit and publishes a GitHub
  Release: the changelog's new lines for players (below), then the pull requests merged since the
  last one. So a failed deploy can't let another build take the same number. If that job fails,
  nothing was deployed: re-run all jobs (a fresh build sees whether the tag was made, and reuses it
  if so; if main has moved on and no tag was made, start a new deploy).
- The release also carries the site built for its own domain (`planner-site.tar.gz` and its
  `.sha256`): the host there fetches it within 10 minutes of the release (`docs/hosting.md`). The
  release is published only once both files are attached.
- The footer names the version after the planner's name, as plain text. The crash page and the
  browser console name it with its commit, and Mids exports carry it in `BuiltWith.Version`
  (`0.0.0` from a dev build; imports ignore it). Each version's notes are on the repository's
  GitHub Releases page.

Merging does not deploy. The owner starts a Pages deploy by hand (Actions -> "Deploy to GitHub
Pages" -> Run workflow, picking a version bump, or `gh workflow run pages.yml --ref main -f
bump=<patch|minor|major>`); it publishes `main` only and runs one at a time.

## What counts as a new version

The version names the application players use, so only a change to what the site is built from
makes a new one (the owner's rule: docs, tests and CI are not the application). The deploy compares
main's tip with the newest version's commit, file by file (`affectsSite` in
`scripts/release-version.mjs`; `tests/releaseversion.test.ts`):

- **Counts:** `src/`, `public/` (the game data and assets with it), `index.html`, `vite.config.ts`,
  `package.json`, `package-lock.json`, the build's `tsconfig` files, and any path not listed below.
  A file nobody thought of errs toward a new version, never toward a changed site under an old
  number.
- **Doesn't count:** `docs/` and every `.md` file outside `src/` and `public/`; `tests/` and `e2e/`
  with their configuration; `.github/` (CI and the deploy workflow); `scripts/`; `hosting/` (the web
  server settings of the site's own domain); the pipeline's and
  the build research's own code, ids files and reports (`pipeline/`, `tools/`, `research/`: what
  they make lands in `public/`, which counts); `.claude/`; the lint configuration, `.gitignore`, `.gitattributes`, `LICENSE`.
- With only such changes since the newest version, the deploy publishes main under that version
  again: the run says so, the bump picked is ignored, and the `release` job is skipped. The pull
  requests show up in the next real release's notes.
- The two commits' files are compared, not their history: a change and its revert are no change.
- A pull request of only such changes calls for no bump ("Bump: none"), and adds no changelog line.

## The changelog

`CHANGELOG.md` (repository root) tells players what changed in each release, newest first.

- A pull request that changes something players can see adds one line under `## Unreleased`, in
  the group that fits: `### New`, `### Improved` or `### Fixed`. A change players can't see (docs,
  CI, the pipeline, tests, refactoring) adds none.
- A line is one sentence in plain words, safe for anyone to read: what a player notices, not how it
  was done. No file or function names, pull request numbers, engine or client terms, or names of
  people. Related changes share a line (four power-info pull requests became one).
- The deploy puts the new lines at the top of the release's notes (`scripts/release-notes.mjs`,
  run by the `build` job; `tests/releasenotes.test.ts`). New means: in `## Unreleased` now, and
  nowhere in the previous release's copy of the file. So nothing has to be renamed or committed at
  deploy time, and a line is never announced twice. A deploy with no new lines publishes the pull
  request list alone, and so does one whose changelog step fails (the run flags it; the deploy goes
  on, and the release's notes can be edited afterwards with `gh release edit`).
- After a deploy, the first pull request to add a line also moves the released lines under their
  own heading, `## vX.Y.Z - Month D, YYYY` (the tag and its date), below a fresh `## Unreleased`.
  Forgetting this only leaves the file untidy; the next release's notes are the same either way.
- A line reworded after its release counts as new, so leave released lines as they are.
