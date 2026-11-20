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
- The site goes to two targets, GitHub Pages and its own domain, each through stages of its own
  ("The deploy's stages", below). The domain's stages attach its site file to the release
  (`planner-site.tar.gz` and its `.sha256`), where its host fetches it (`docs/hosting.md`).
- The footer names the version after the planner's name, as plain text. The crash page and the
  browser console name it with its commit, and Mids exports carry it in `BuiltWith.Version`
  (`0.0.0` from a dev build; imports ignore it). Each version's notes are on the repository's
  GitHub Releases page.

Merging does not deploy. The owner starts a Pages deploy by hand (Actions -> "Deploy to GitHub
Pages" -> Run workflow, picking a version bump, or `gh workflow run pages.yml --ref main -f
bump=<patch|minor|major>`); it publishes `main` only and runs one at a time.

## The deploy's stages

The deploy publishes to two targets, GitHub Pages and the site's own domain (`docs/hosting.md`).
Its stages are the jobs of `.github/workflows/pages.yml`:

1. **Check and pick the version** (`prepare`): the tests, the type check and the version.
2. **Tag the release** (`release`), as soon as those checks have passed.
3. **Build**, one job per target, side by side (`build-pages`, `build-domain`).
4. **Publish**, one job per target: `deploy-pages` puts its build live on GitHub Pages, and
   `publish-domain` attaches the domain's site file to the release.
5. **Check the domain switched** (`check-domain`): its host fetches a release by itself, so this
   stage waits (up to 20 minutes) until the domain serves the new build.
6. **Report** (`report`, `scripts/deploy-report.mjs`): the run's summary page says what each
   target got.

Stages 1 and 2 are what both targets share: a failure there stops the deploy for both. From stage
3 on each target has jobs of its own, and none of them needs any of the other's.

- **One target fails:** its site stays on the version it had, the other goes live, and the run is
  marked failed, so GitHub notifies whoever started it. The summary names the target, the stage
  and what to do.
- **Trying a target again:** "Re-run failed jobs" on the run. Only that target's jobs run: the
  first job is not run again, so the version stands, and the other target's jobs are not touched.
  (If the `release` job itself failed, re-run all jobs, as above.)
- **A try that comes without the first job's checks** looks again at what those checks guard,
  since a newer deploy may have gone out in between. The `release` job tags only while this is
  still main's newest commit, and the publishing jobs go on only while this version is still the
  newest release. So "Re-run failed jobs" on an old run can't put old code over a newer version.
  "Re-run all jobs" makes the checks again, and stays the way to put an older release back on
  GitHub Pages on purpose.
- **The tag comes before the builds**, so that trying one target again never comes back through
  the `release` job. A version whose builds both fail is tagged with nothing deployed under it:
  try again, or let the next deploy take the next number.
- **When the domain's stages run:** for every new version, and for a later deploy of the newest
  release when it still has no site file (its domain stages failed before). They don't run when the
  release has its file, or when an older release is put back on GitHub Pages: the domain only moves
  forward on its own (`docs/hosting.md`, "By hand"). If GitHub can't be asked which it is, the
  domain is left alone and the report says it was not checked.
- **Published but not seen live:** the release has its site file, yet the domain did not serve it
  in time. Nothing in the deploy can put that right: look at the host (`docs/hosting.md`, "By
  hand"). Once it is mended it fetches the release by itself, and "Re-run failed jobs" has the
  domain looked at again.
- **How long it takes:** GitHub Pages is live after its own jobs, as before. The run itself ends
  when the domain check does, usually within about 12 minutes of the release (the host looks every
  10), and 20 when the domain never switches. A deploy started meanwhile waits for it, and of
  several waiting only the newest is kept.

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
