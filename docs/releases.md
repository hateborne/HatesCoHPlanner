# Versions and releases

How a deploy picks, tags and stamps a version. The bump rules are in `AGENTS.md`.

Every deploy is a release with a SemVer version, `vX.Y.Z`. The first public release (the site as
deployed on November 13, 2026) is `v1.0.0`. The owner's rules for the bump:

- **major**: massive feature changes or redesigns;
- **minor**: a new server, or medium-sized work;
- **patch**: fixes and small changes.

When you hand back a pull request, say which bump it calls for, so the owner can pick it at deploy.

- The git tags are the record. `package.json`'s `version` is not used.
- The deploy picks the version (`scripts/release-version.mjs`): the newest `vX.Y.Z` tag, bumped as
  picked. It refuses to run without a bump, and refuses before any version tag exists. A commit that
  already carries a version deploys again under it, with no new tag (re-running an older release's
  deploy puts that release back live). A new version goes only to main's newest commit, so re-running
  an old deploy that failed before it was tagged is refused once main has moved on: start a new one.
- The build gets the version from `HCP_VERSION` and the commit from `HCP_COMMIT`
  (`vite.config.ts`, read through `src/version.ts`). Builds outside a deploy (dev server, tests,
  pull request checks) are `dev`.
- Before the site goes live, the deploy's `release` job tags the commit and publishes a GitHub
  Release listing the pull requests merged since the last one, so a failed deploy can't let
  another build take the same number. If that job fails, nothing was deployed: re-run all jobs (a
  fresh build sees whether the tag was made, and reuses it if so; if main has moved on and no tag
  was made, start a new deploy).
- The footer names the version after the planner's name, as plain text. The crash page and the
  browser console name it with its commit, and Mids exports carry it in `BuiltWith.Version`
  (`0.0.0` from a dev build; imports ignore it). Each version's notes are on the repository's
  GitHub Releases page.

Merging does not deploy. The owner starts a Pages deploy by hand (Actions -> "Deploy to GitHub
Pages" -> Run workflow, picking a version bump, or `gh workflow run pages.yml --ref main -f
bump=<patch|minor|major>`); it publishes `main` only and runs one at a time.
