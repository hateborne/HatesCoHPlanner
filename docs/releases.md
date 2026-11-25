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
- Before the site goes live, the deploy's `release` job tags the commit (pushing the tag with the
  deploy key: "The release key and main's rules", below) and publishes a GitHub
  Release: the changelog's new lines for players (below), then the pull requests merged since the
  last one. So a failed deploy can't let another build take the same number. If that job fails,
  nothing was deployed: re-run all jobs (a fresh build sees whether the tag was made, and reuses it
  if so; if main has moved on and no tag was made, start a new deploy).
- The site goes to two targets, GitHub Pages and its own domain, each through stages of its own
  ("The deploy's stages", below). The domain's stages attach its site file to the release
  (`planner-site.tar.gz`, its `.sha256` and its signature, `.sig`), where its host fetches it
  (`docs/hosting.md`).
- The footer names the version after the planner's name, as plain text. The crash page and the
  browser console name it with its commit, and Mids exports carry it in `BuiltWith.Version`
  (`0.0.0` from a dev build; imports ignore it). Each version's notes are on the repository's
  GitHub Releases page.

Merging does not deploy. The owner starts a Pages deploy by hand (Actions -> "Deploy to GitHub
Pages" -> Run workflow, picking a version bump, or `gh workflow run pages.yml --ref main -f
bump=<patch|minor|major>`); it publishes `main` only and runs one at a time. It goes to both
GitHub Pages and the site's own domain unless a target is picked (`-f target=pages` or
`-f target=domain`), which is for deploying one of them again after it failed.

## The deploy's stages

The deploy publishes to two targets, GitHub Pages and the site's own domain (`docs/hosting.md`).
Its stages are the jobs of `.github/workflows/pages.yml`:

1. **Check and pick the version** (`prepare`): the tests, the type check and the version.
2. **Tag the release** (`release`), as soon as those checks have passed. Right after it,
   **Stamp the changelog** (`stamp-changelog`) moves the release's lines under its version's
   heading on main ("The changelog", below). It runs whichever targets the run is for, and no
   build waits for it.
3. **Build**, one job per target, side by side (`build-pages`, `build-domain`).
4. **Publish**, one job per target: `deploy-pages` puts its build live on GitHub Pages, and
   `publish-domain` signs the domain's site file and attaches it to the release.
5. **Check the domain switched** (`check-domain`): its host fetches a release by itself, so this
   stage waits (up to 20 minutes) until the domain serves the new build.
6. **Report** (`report`, `scripts/deploy-report.mjs`): the run's summary page says what each
   target got.

Stages 1 and 2 are what both targets share: a failure there stops the deploy for both (but for the
changelog stamp, which holds nothing back). From stage
3 on each target has jobs of its own, and none of them needs any of the other's.

- **One target fails:** its site stays on the version it had, the other goes live, and the run is
  marked failed, so GitHub notifies whoever started it. The summary names the target, the stage
  and what to do.
- **Trying a target again:** "Re-run failed jobs" on the run. Only that target's jobs run: the
  first job is not run again, so the version stands, and the other target's jobs are not touched.
  (If the `release` job itself failed, re-run all jobs, as above.)
- **One target alone, in a run of its own:** the `target` choice when starting a deploy (`both`
  by default, `pages` or `domain`). The other target's jobs are skipped and its site stays as it
  is; the report lists it as left out. This is the way to deploy one site again without the run
  that failed, for example once that run is too old to re-run (its build files are kept 1 to 7
  days). On a commit that already has its version, no bump is needed and nothing is tagged. If main
  has moved on since with changes to the site, the run needs a bump like any other and releases a
  new version, to that one site: the other is then a version behind until a run that includes it,
  and the report says so. A run for the domain alone that can do nothing for it (its version is not
  the newest release) ends failed, and says that too.
- **A try that comes without the first job's checks** looks again at what those checks guard,
  since a newer deploy may have gone out in between. The `release` job tags only while this is
  still main's newest commit, and the publishing jobs go on only while this version is still the
  newest release. So "Re-run failed jobs" on an old run can't put old code over a newer version.
  "Re-run all jobs" makes the checks again, and stays the way to put an older release back on
  GitHub Pages on purpose.
- **The tag comes before the builds**, so that trying one target again never comes back through
  the `release` job. A version whose builds both fail is tagged with nothing deployed under it:
  try again, or let the next deploy take the next number.
- **What the domain's stages do** (unless the run is for GitHub Pages alone): for a new version,
  and for the newest release while it still has no signed site file (its domain stages failed, or
  were left out, before, or it is from before files were signed), they build the site, sign and
  attach it, and check the domain. When the newest release has its signed file already, only the
  check runs, so a host that failed to fetch it shows up again.
  When an older release is put back on GitHub Pages they do nothing: the domain only moves forward
  on its own (`docs/hosting.md`, "By hand"). If GitHub can't be asked which it is, the domain is
  left alone and the report says it was not checked.
- **The check compares the domain with the release's own site file**, the very one its host
  fetches, not with a build of the run, after checking that file against its checksum as the host
  does. It does not check the signature: a host that refuses one shows up as not seen live, with
  the reason in the host's update log. When the check can't be made at all (GitHub doesn't answer, or a newer release has gone out
  since), the report says that, and not that the host is stuck.
- **Published but not seen live:** the release has its site file, yet the domain did not serve it
  in time. Nothing in the deploy can put that right: look at the host (`docs/hosting.md`, "By
  hand"). Once it is mended it fetches the release by itself, and "Re-run failed jobs", or a new
  run with `target=domain`, has the domain looked at again.
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
  run by the `prepare` job; `tests/releasenotes.test.ts`). New means: in `## Unreleased` now, and
  nowhere in the previous release's copy of the file, so a line is never announced twice. A deploy
  with no new lines publishes the pull request list alone, and so does one whose changelog step
  fails (the run flags it; the deploy goes on, and the release's notes can be edited afterwards
  with `gh release edit`).
- Once the version is tagged, the deploy's `stamp-changelog` job moves the lines it shipped under
  their own heading, `## vX.Y.Z - Month D, YYYY` (the release's date, New York time), below a fresh
  `## Unreleased`, in one commit pushed straight to main (`scripts/changelog-stamp.mjs`;
  `tests/changelogstamp.test.ts`). No pull request is needed for it. It runs for a new version
  only, whether the run is for both targets or one, and does nothing for a run that reuses a
  version.
  - Only the lines the released commit had under `## Unreleased` move. Lines merged after the deploy
    started stay there for the next release.
  - A version that has its heading already is left as it is, so the job is safe to run again
    ("Re-run failed jobs"). A release that shipped no lines gets no heading.
  - If it fails, both sites still go live; the run is marked failed and its report says the
    changelog was not stamped. The next release's notes are right either way, since they compare
    with the previous release's copy.
  - The stamp commit changes `CHANGELOG.md` only, which is not part of the site, so it never makes
    a new version by itself.
- A line reworded after its release counts as new, so leave released lines as they are.

### The release key and main's rules

`main` takes changes through pull requests only, so the stamp (and each new version tag) is pushed
with a deploy key that main's rules let through. Only the `release` environment holds it. This is
how the repository is set up (an agent never changes settings, rulesets or secrets on its own):

- **The deploy key:** one key with write access, under Settings -> Deploy keys. Its private half
  is the secret `RELEASE_DEPLOY_KEY` of the `release` environment.
- **The `release` environment:** deploys from `main` only. It holds `RELEASE_DEPLOY_KEY` and
  `SITE_SIGNING_KEY` (the domain's signing key: `docs/hosting.md`, "The site file's signature").
- **The rulesets** (Settings -> Rules -> Rulesets). A ruleset's "Deploy keys" bypass lets every
  deploy key of the repository through, so any other deploy key added here must be read-only.

| Ruleset | Applies to | Rules | Bypass |
|---|---|---|---|
| main: history kept | the default branch | no deleting it, no force pushes | none |
| main: pull requests, owner approval | the default branch | a pull request with the code owner's approval (approval of the last push, stale approvals dismissed) | deploy keys (always); repository admins (for pull requests only, which is how the owner approves their own) |
| main: required checks | the default branch | the four checks of `ci.yml`, on a branch up to date with main | deploy keys (always) |
| version tags: deploy key only | tags `v*` | no making, moving or deleting them | deploy keys (always) |

Force pushes and deleting main are kept in a ruleset of their own with no bypass, so the key can
skip the pull request and the checks but nothing else.

What else guards the stamp's push:

- The key lives in an environment that only runs from main, so a workflow run from any other
  branch can't read it.
- The job refuses to run from another branch or for anyone but the owner, refuses a stamp that
  changes any file but `CHANGELOG.md`, and never forces: if main moves while it works, it starts
  again from the new tip (three tries).
- Its commit is made in the name of `github-actions[bot]`, so it is easy to pick out in main's
  history.

To replace the key (lost, or suspected leaked):

1. Make a key pair with no passphrase: `ssh-keygen -t ed25519 -N "" -C release-deploy -f stamp`.
2. Settings -> Deploy keys: delete the old key, then add the public half (`stamp.pub`) with
   **Allow write access** ticked.
3. Settings -> Environments -> `release`: set `RELEASE_DEPLOY_KEY` to the private half (`stamp`).
   Then delete both files from your machine. The rulesets need no change.

## What a branch's workflow can't do

GitHub runs a workflow file from the branch that adds it: a new file with a `push` or
`pull_request` trigger runs from that branch before anyone has looked at it, and may ask for a token
that writes to the repository. GitHub has no setting to stop that, so nothing worth taking is left
within its reach:

- **Secrets:** none at repository level, ever. Every secret lives in an environment that runs from
  main only (`release`: the deploy key and the signing key; `github-pages`), which a branch's run
  can't enter.
- **main:** its rulesets want a pull request with the owner's approval and passing checks. Only
  the deploy key gets past them without a pull request, and force pushes and deleting main are
  forbidden for everyone (the table above).
- **The pull request checks:** always main's copy of `ci.yml` (`pull_request_target`).
- **Version tags:** only the deploy key may make, move or delete a `v*` tag, so a branch's token
  can't make a release with a new version (and so a release that looks newer than the real one).
- **The domain:** its host installs only a site file signed for its own release by the signing key
  (`docs/hosting.md`), so a file or release put up with a branch's token is refused.
- **GitHub Pages:** its environment deploys from main only.
- **Starting a deploy:** a branch's token may start or re-run the deploy, which then publishes
  main as it is; its jobs refuse any run the owner did not start or re-run.

What such a run can still do with a write token is untidy rather than harmful, and shows up on the
repository: push other branches and non-version tags, edit or delete a release's notes or files
(the host refuses what it can't verify), or cancel runs.
