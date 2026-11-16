// written in by vite.config.ts's define; missing where Vite doesn't compile the code (the Playwright
// tests import the Mids code through tests/helpers/data.ts), hence the typeof checks
declare const __HCP_VERSION__: string | undefined;
declare const __HCP_COMMIT__: string | undefined;

// what a build outside a deploy is called
const DEV = 'dev';

// The planner's release, stamped by the deploy (HCP_VERSION, checked in vite.config.ts): "1.2.0", or
// "dev" for a local or pull request build. The deploy tags each one vX.Y.Z (AGENTS.md, "Versions and
// releases").
export const APP_VERSION: string = typeof __HCP_VERSION__ === 'string' ? __HCP_VERSION__ : DEV;
// The deployed commit's first 7 characters ("" in a dev build).
export const APP_COMMIT: string = typeof __HCP_COMMIT__ === 'string' ? __HCP_COMMIT__ : '';

/** @return The version as shown: "v1.2.0", or "dev" for a build that isn't a release. */
export function versionLabel(v: string = APP_VERSION): string {
  return v === DEV ? DEV : `v${v}`;
}

/**
 * The version as three numbers, for files that record it that way (a Mids export's
 * BuiltWith.Version).
 *
 * @param v The version ("1.2.0" or "dev").
 * @return The version, or "0.0.0" for a dev build.
 */
export function numericVersion(v: string = APP_VERSION): string {
  return v === DEV ? '0.0.0' : v;
}
