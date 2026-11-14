/**
 * The game server last shown in this browser, so the server list starts on it next time (a
 * per-browser convenience: blocked or cleared storage just means the default starts highlighted).
 */
import { serverById, type GameServer } from '../data/servers.ts';

/** The localStorage key holding the last shown server's id. */
export const LAST_SERVER_KEY = 'hcp.server';

/**
 * The server last shown in this browser.
 *
 * @param storage Where it is kept (localStorage; tests pass their own).
 * @return It, when the site still carries it; undefined when none is remembered or storage is blocked.
 */
export function lastServer(storage: () => Pick<Storage, 'getItem'> = () => localStorage): GameServer | undefined {
  // even touching window.localStorage throws when site data is blocked, so the access is inside the try
  try {
    return serverById(storage().getItem(LAST_SERVER_KEY) ?? undefined);
  } catch {
    return undefined;
  }
}

/**
 * Remember the server shown now (ids the site doesn't carry are ignored).
 *
 * @param id The server's id.
 * @param storage Where it is kept (localStorage; tests pass their own).
 */
export function rememberServer(id: string, storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage): void {
  if (!serverById(id)) return;
  try {
    const s = storage();
    if (s.getItem(LAST_SERVER_KEY) !== id) s.setItem(LAST_SERVER_KEY, id);
  } catch {
    /* storage unavailable: the default starts highlighted next time */
  }
}
