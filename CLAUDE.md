# Claude Code reads this file; the project guidance for every agent lives in AGENTS.md.
@AGENTS.md

# Claude Code workflow in this repository

Conventions that sessions here have tended to miss. They apply on top of AGENTS.md.

## Questions, reviews, fixes
- A question is not a go-ahead. Answer it and change nothing until asked.
- An "adversarial review" hunts bugs, landmines and spec misses in the whole diff of every
  branch or PR in play, on desktop and phone, and on Homecoming and every other server.
- Run one before opening any PR, even when not asked. List the findings numbered and ranked,
  low and nitpick included, and let the owner pick which to fix before changing anything.

## Local testing
- Test in a desktop Chromium browser. Check the phone layout with DevTools device emulation
  (iPhone and Pixel presets); a real phone on the LAN usually can't reach the dev server.
- To open the local instance, stop any other dev server first (port 5173 is strict), run
  `vite-dev` (`.claude/launch.json`) from the checkout or worktree of the branch under test,
  and give the link http://localhost:5173/HatesCoHPlanner/Homecoming/ (plus `#b=` if relevant).

## Branches, PRs, deploys
- Each PR has its own branch, often in a worktree under `.claude/worktrees/`. Worktree folder
  names need not match branch names: check `git worktree list` and `gh pr list` before saying
  where work is, and always name the branch and PR a change went to.
- A new server's work (pipeline, data, its restrictions, its difference report, its tests)
  belongs in that server's feature PR. Homecoming fixes found along the way get their own PR.
- Deploy only when asked: `gh workflow run pages.yml --ref main -f bump=<the bump named in the PR>`.
  Nothing runs on main after a merge to wait for: the pull request's checks ran on a branch up to
  date with main, and the deploy runs the tests and the build again before it publishes.
- Cleaning up after merges: pull main, then delete the local branches and worktrees whose PRs
  have merged.

## Scope
- A UI change reaches every screen that shows the thing: desktop and phone layouts, and New
  Build, Choose a New Power, the pool / epic / patron pool screens, slotting and the overview.
  Grep for every use before calling it done, unless the request names one layout.
- Add nothing that wasn't asked for: no extra links, hint text or buttons.

## Game facts that are easy to get wrong
- Set bonuses need 2 or more different pieces of one set (`SET_BONUS_MIN_PIECES`). A unique
  piece's own global (Luck of the Gambler's recharge, procs) is not a set bonus; never "(1)".
- The live client is the spec. A `build.txt` from the game is valid: if the planner flags it,
  the planner is wrong. Each server's own data decides what is legal there (Hard Life and Pale
  Blade are real Tanker secondaries on Thunderspy).
