# The site on its own domain

Every new version of the planner is published twice: on GitHub Pages
(`https://hateborne.github.io/HatesCoHPlanner/`) and on the owner's own domain
(`https://cohplanner.hateborne.com/`), a small virtual server that only hands out files. This file
says how the two differ, how a release reaches the domain, and how to set that host up again. Its
settings are in `hosting/`.

## Two addresses, one site

- Both are the same commit and version, built twice: for GitHub Pages under `/HatesCoHPlanner/`
  (`PAGES_BASE`, the default), and for the domain under `/` (`HCP_BASE=/`, read by `siteBase` in
  `vite.config.ts`). Every address the planner makes or reads comes from that one base
  (`import.meta.env.BASE_URL`), so on the domain a share link is
  `https://cohplanner.hateborne.com/Homecoming/#b=...`.
- Links made on the domain are under the links rule in `AGENTS.md` like any other: the domain keeps
  serving the planner, with every published version folder, for as long as the project lives.
- A link made on GitHub Pages opens on the domain with only its host changed. The address
  `/HatesCoHPlanner/Homecoming/` has no file there, so the site's own "not found" page sends it on
  to `/Homecoming/` with its `#b=` code (`notFoundRedirect` with `PAGES_BASE`). That is in the build
  itself, so it has tests and needs no rule in the web server.
- The other way round is not the same: a link made on the domain opens on GitHub Pages only with
  `/HatesCoHPlanner` put back into its path by hand, because GitHub answers `/Homecoming/` before
  any of the planner's code loads.
- Pasted into the Import box, a link reads the same on both sites (`serverInLink`). GitHub Pages
  goes by the path alone, as it always has. On the domain every path is under `/`, so the path
  can't tell whose link it is: a GitHub Pages link reads as it does there (`onThisSite`), a link on
  the domain's own host reads by its path, and a link on any other site names no server, so its
  code decides (as on GitHub Pages).
- Builds saved in the browser belong to the address they were saved at. The two sites don't share
  them.
- The domain's web server sends its data as brotli to every browser. GitHub Pages can't, so there
  the planner asks for brotli copies itself where the browser can unpack them
  (`src/data/packed.ts`); the domain's build is not marked for that and never does.
- None of this changes what the GitHub Pages build does: with the default base, `serverInLink` and
  the 404 page's redirect behave exactly as they did (`tests/servers.test.ts`).

## How a release reaches the domain

- The deploy (`.github/workflows/pages.yml`) builds the site a second time for `/`, writes
  pre-compressed copies of its text files beside them (`scripts/precompress.mjs`: `name.br` and
  `name.gz`), packs it as `planner-site.tar.gz` with a `.sha256`, and attaches both to the GitHub
  release. It does so for every new version, and again for the newest release while that still has
  no site file (its first try failed).
- The domain is a target of its own in the deploy (`docs/releases.md`, "The deploy's stages"). If
  its build or its file fails, GitHub Pages still goes live, and the other way round; the run is
  marked failed and its summary says which site was left behind. So the two can differ for a
  while, but never unnoticed.
- The deploy's last stage waits until the domain serves the new build (up to 20 minutes), and
  fails if it never does: the only sign of a host that is stuck.
- On the host a timer runs `planner-update` every 10 minutes (`hosting/planner-update.sh`). It asks
  GitHub for the newest release's name. When that is newer than the release the site is on, it
  downloads the file, checks it against its checksum, unpacks it beside the site and switches over
  by renaming a link (`current`), so a request sees one release or the other, never half of each.
- Whatever goes wrong leaves the site as it was, the run is marked failed (`systemctl status
  planner-update.service`), and the next run tries again.
- The host only moves forward on its own. A link made on a newer release may need a game version an
  older one doesn't have, so going back is done by hand (below), never because GitHub's newest
  release changed (a deleted release, an older one marked newest).
- Putting an older release back live on GitHub Pages (re-running its deploy, `docs/releases.md`)
  does not move the domain: do that by hand too.
- The host asks GitHub; nothing reaches into the host. GitHub holds no key to it, and the
  repository doesn't hold its address. (GitHub does see the address its requests come from, as any
  site would.)
- The two sites don't switch at the same moment: the release is published before GitHub Pages goes
  live, and the host picks it up within 10 minutes.
- A release with no site file (`v1.1.0` and older) leaves the site as it is.
- A change to `scripts/precompress.mjs` or to the deploy's packing steps alone makes no new version
  (`docs/releases.md`, "What counts as a new version"), so it reaches the domain with the next
  version. A change to `hosting/` is installed on the host by hand (below).

## The host

- **Web server:** Caddy from Ubuntu's own packages (`hosting/Caddyfile`). It gets and renews the
  certificate itself, sends the pre-compressed copies as they are (nothing is compressed per
  request), answers `Cache-Control: max-age=600` as GitHub Pages does, gives an address with no
  file the site's own `404.html`, and drops a connection that sends its request slowly or not at
  all.
- **Files:** `/srv/planner/` belongs to the user `planner`, who can't log in. `releases/<version>/`
  holds each unpacked release (the current one and the two installed before it), and `current` is
  the link the web server reads.
- **Updates:** `planner-update` runs as that user under systemd (`hosting/planner-update.service`),
  which lets it write that folder and nothing else, and caps its processor time and memory so an
  update never slows the site.
- **Firewall:** ufw lets in SSH and the web ports (80 and 443) only.
- **Not in the repository:** the host's IP address, its SSH key and the account it runs under. They
  must never be (`AGENTS.md`, "Privacy").

## Setting the host up

On a new Ubuntu host, as root, from a checkout of this repository. The domain's DNS record has to
point at the host first, or Caddy can't get its certificate.

```bash
apt-get update && apt-get install -y caddy
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443 && ufw --force enable
useradd --system --home-dir /srv/planner --shell /usr/sbin/nologin planner
install -d -o planner -g planner -m 755 /srv/planner
install -m 755 hosting/planner-update.sh /usr/local/bin/planner-update
install -m 644 hosting/planner-update.service hosting/planner-update.timer /etc/systemd/system/
install -m 644 hosting/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now planner-update.timer
systemctl start planner-update.service
systemctl reload caddy
```

A change to a file in `hosting/` reaches the host the same way: install the file again, then
`systemctl daemon-reload` (the service or the timer) or `systemctl reload caddy` (the Caddyfile).

## By hand

```bash
systemctl start planner-update.service        # look for a new release now
systemctl status planner-update.service       # whether the last run failed
journalctl -u planner-update.service -n 20    # what the last runs did
ls -l /srv/planner/current /srv/planner/releases
```

Anything that changes the site's folder runs as its user (`sudo -u planner`): `planner-update`
refuses to run as anyone else, since a file root leaves there stops every later run.

- **Going back to a kept release:** stop the timer and any run in progress, then switch:

  ```bash
  systemctl stop planner-update.timer planner-update.service
  sudo -u planner planner-update --to <version>
  ```

  The timer would move the site forward again within 10 minutes, so leave it stopped until a fixed
  release is out, then `systemctl start planner-update.timer`.
- **Installing a site file by hand** (a build to try before it is released):
  `sudo -u planner planner-update --file <file> <name>`. The timer replaces it as soon as the newest
  release has a site file, so stop the timer while trying one.
- **Making a site file on your own machine:**

  ```bash
  HCP_BASE=/ npx vite build --outDir dist-own
  node scripts/precompress.mjs dist-own
  tar -czf planner-site.tar.gz -C dist-own .
  ```

  Git Bash on Windows rewrites a value of `/` on its way to Node (the build stops and says so).
  Set it in PowerShell there (`$env:HCP_BASE = '/'`), and clear it afterwards
  (`Remove-Item Env:HCP_BASE`): left set, every later build and dev server in that window is for
  the root path.
