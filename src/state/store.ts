/**
 * App state: loaded game data, the build, and the level-up flow (wizard or editing one level
 * from the overview). Screens read from here and call these actions; the rules live in engine/.
 */
import { create } from 'zustand';
import { loadGameData, type GameData } from '../data/gamedata.ts';
import { dataRoot, DEFAULT_SERVER, defaultServer, serverById, serverFromPath, serverHref, serverOf, SERVERS, versionServer, withServer, type GameServer } from '../data/servers.ts';
import { loadVersions, missingVersionNote, normalizeVersion, resolveVersion, type GameVersion, type GameVersions } from '../data/versions.ts';
import { addSlot, raiseToCap, setPick, swapPick, type SwapPiece } from '../engine/actions.ts';
import { pieceName } from '../engine/enhance.ts';
import { cleanName, cloneBuild, hasWork, newBuild, type Alignment, type Build } from '../engine/build.ts';
import { BuildRules, buildPairProblem, levelUpRespec, MAX_LEVEL } from '../engine/rules.ts';
import { checkBuild } from '../engine/validate.ts';
import { levelSteps, lowestFreeLevels, respecSteps, stepSlotLevels, type LevelStep } from '../engine/schedule.ts';
import { describeImportFailure, ImportProblem, refusedBuild, unknownServer, wrongServer } from '../io/importProblem.ts';
import { decodeShare, encodeShare } from '../io/share.ts';
import { stageLayout } from '../ui/stageLayout.ts';
import { lastServer, rememberServer } from './lastServer.ts';
import { returning, trackUse } from './lastUsed.ts';
import { tabTitle } from './tabTitle.ts';

export type View = 'loading' | 'error' | 'setup' | 'level' | 'overview';

/** The changes made when an import was moved to another game patch, kept on the overview until dismissed. */
export interface PatchNotes {
  title: string; // "Changes for Issue 28, Page 4"
  lines: string[]; // one change per line, "before -> after"
}
/** One row of options in the planner's dialog (askChoices); one option is always picked. */
export interface DialogChoice {
  label: string; // the row's heading ("Alignment")
  options: { id: string; label: string; block?: string }[]; // block: why it can't be picked (greyed, reason shown)
  value: string; // the picked option's id
}
/** Hover tooltips: Enabled (description / slot details; Shift shows Advanced), Advanced, Disabled. */
export type TipMode = 'enabled' | 'advanced' | 'disabled';
export const TIP_MODES: TipMode[] = ['enabled', 'advanced', 'disabled'];
export type LevelSub = 'power' | 'pool' | 'epic' | 'slots';

/** Where the level-up flow is and what the user has chosen but not yet confirmed. */
/** A list under a dialog's text, with the line that introduces it (askConfirm's `sections`). */
export interface DialogSection {
  heading: string; // the line above the list ("will drop the following enhancements:")
  lines: string[]; // one item per line, drawn as a bullet
}

/** A phrase in a dialog's text that opens a page in a new tab (an address in the planner's own code, never one from a build or file). */
export interface DialogLink {
  phrase: string; // the words in the text to link (the first time they appear)
  href: string; // https address
}

export interface LevelCtx {
  step: number; // index into levelSteps()
  pickInStep: number; // which of the step's picks (level 1 has two)
  mode: 'wizard' | 'edit';
  sub: LevelSub;
  base: Build; // build without this level's choice
  orig: Build; // build before editing (edit mode; restored on Cancel)
  pendingPower?: number;
  pendingSet?: number; // a new pool/epic set chosen on the set picker
  pendingSlots: string[]; // entry keys, one per slot placed at this level
  flow?: LevelStep[]; // a Respec build's wizard order (respecSteps); absent: the leveling order
  freed?: boolean; // the slot screen after a power swap freed slots: `flow` holds one step with just those slots
}

interface Store {
  server: string; // the game server whose data is shown (the build's, or the one picked on New Build)
  /**
   * Show another game server's data on New Build, on its default game version, and clear the
   * current build (a build never moves to another server: its archetype and sets may not exist
   * there; the caller asks first). New Build then clears its archetype and power sets. Refused on
   * every other screen.
   *
   * @param id The server's id.
   * @return Whether it is shown (the build is cleared only then).
   */
  selectServer(id: string): Promise<boolean>;
  serverAsk: { cancellable: boolean; preselect: string; resume?: ResumeLabel; resolve: (id: string | null) => void } | null; // the server list dialog, while open
  /**
   * Ask which game server to use, in the server list dialog.
   *
   * @param cancellable Whether it can be closed without a pick (switching servers from the logo); a
   *   first visit's can't, and Escape there takes the preselected server.
   * @param preselect The server highlighted at first (Enter, Space or OK takes it).
   * @param resume The label of a button that continues the last build instead (a page load after a
   *   long break); it starts highlighted then.
   * @return The picked server's id, CONTINUE_BUILD for the resume button, or null when cancelled.
   */
  askServer(cancellable: boolean, preselect: string, resume?: ResumeLabel): Promise<string | null>;
  /** Close the server list dialog with a pick, or with null as cancelled. */
  closeServerAsk(id: string | null): void;
  gd?: GameData; // the data of the version being shown (the build's, or the one picked on New Build)
  steps: LevelStep[];
  versions?: GameVersions; // every game version the site has data for, on the server shown
  /** Show another game version's data (the New Build screen's version picker); false if it failed. */
  selectVersion(id: string): Promise<boolean>;
  error?: string;
  view: View;
  build?: Build;
  level?: LevelCtx;
  muted: boolean; // the Sound switch, off is muted (this tab's; new tabs start from the last change in any tab)
  musicOn: boolean; // the login-screen music switch (this tab's, like muted; on by default, off on phones)
  setupAlign: Alignment; // the alignment picked on the setup screen (its skin and backdrop)
  tips: TipMode; // hover tooltip setting (the browser's: open tabs follow a change in any tab)
  shift: boolean; // Shift held: Enabled tooltips show the Advanced view
  setTips(m: TipMode): void;
  notice: { id: number; text: string } | null; // a short red message (a refused change)
  notify(text: string): void;
  dismissNotice(): void; // a tap on the phone toast
  lockFlash: { id: number; key: string; label: string } | null; // a power bar flashing a refusal
  poolsBlinked: boolean; // phones: the Pools tab has blinked for this build's first pool pick
  epicBlinked: boolean; // phones: ...and for the first pick that can open an epic pool
  flashLocked(key: string, label?: string): void;
  confirm: {
    title: string;
    text: string;
    okLabel?: string;
    cancelLabel?: string; // the last button's label (default Cancel)
    altLabel?: string; // a third button between them (askThreeWay)
    lines?: string[];
    sections?: DialogSection[]; // lists with headings, in the list box (askConfirm)
    highlight?: string[]; // phrases in the text drawn in the game's yellow (power names)
    choices?: DialogChoice[];
    alert?: boolean; // a message with one OK button (tell)
    link?: DialogLink; // a phrase in the text that opens a page
    waitUntil?: number; // a countdown message: it can't be closed before this time (performance.now() ms, which a clock change can't move)
    resolve: (answer: boolean | 'alt', picked?: string[], replaced?: boolean) => void; // replaced: by a newer dialog, unanswered
  } | null;
  /** Ask a yes / no question in the planner's dialog (with an optional list under it); resolves true on Proceed. */
  askConfirm(q: { title: string; text: string; okLabel?: string; cancelLabel?: string; lines?: string[]; sections?: DialogSection[]; highlight?: string[] }): Promise<boolean>;
  /**
   * Ask a question with two ways forward and Cancel in the planner's dialog.
   *
   * Cancel has the keyboard focus, so Escape and Enter stay where the player is.
   *
   * @param q The question: OK's label, the second way's label, and Cancel's (default Cancel).
   * @return 'ok' or 'alt' for the first two buttons, 'cancel' for Cancel and Escape, 'replaced'
   *   when a newer dialog took its place before the player answered.
   */
  askThreeWay(q: { title: string; text: string; okLabel: string; altLabel: string; cancelLabel?: string }): Promise<'ok' | 'alt' | 'cancel' | 'replaced'>;
  /**
   * Ask for one option in each of several rows in the planner's dialog.
   *
   * @param q The question; each row starts on its `value`.
   * @return The picked option id of each row, in order, or null when cancelled.
   */
  askChoices(q: { title: string; text: string; okLabel?: string; choices: DialogChoice[] }): Promise<string[] | null>;
  /** Pick an option in a row of the open dialog (ignored when the option is blocked). */
  setConfirmChoice(row: number, id: string): void;
  /**
   * Show a message in the planner's dialog with one OK button (an optional list under it, an
   * optional phrase linking to a page); resolves when it closes. With `wait`, OK (and Escape)
   * unlock only after that many seconds, counted down on the button, and a newer dialog waits for
   * it to close instead of replacing it.
   */
  tell(q: { title: string; text: string; lines?: string[]; link?: DialogLink; wait?: number }): Promise<void>;
  patchNotes: PatchNotes | null; // what a patch move changed in the current build
  /** Show (or with null, dismiss) the current build's patch-move changes; remembered per tab. */
  setPatchNotes(n: PatchNotes | null): void;
  /** @return A game version's data (fetched once per page), for imports that open on another version. */
  dataForVersion(id: string): Promise<GameData>;
  /** Close the dialog: true for its OK button, 'alt' for askThreeWay's second, false to cancel. */
  closeConfirm(answer: boolean | 'alt'): void;
  load(): Promise<void>;
  /** Start a new build's wizard; `respecTo` (0-based) makes it a Respec: every power first, then the slots. */
  startBuild(args: { name: string; at: number; origin: number; alignment: Alignment; primary: number; secondary: number; respecTo?: number }): void;
  setBuild(b: Build): void;
  toSetup(): void;
  toOverview(): void;
  choosePower(power: number | undefined): void;
  openSetPicker(kind: 'pool' | 'epic'): void;
  closeSetPicker(set?: number, power?: number): void;
  addPendingSlot(key: string): void;
  removePendingSlot(index: number): void;
  finishLevel(): void;
  backLevel(): void;
  cancelLevel(): void;
  editPick(pickIndex: number): void;
  editSlots(level: number): void;
  stopHere(openMenu: boolean): void;
  continueLeveling(): void;
  setMuted(m: boolean): void;
  setMusicOn(on: boolean): void;
  menuOpen: boolean;
  setMenu(open: boolean): void;
  advancedRespec: boolean; // Advanced Respec (browser setting): a Respec build's power picks advance on a click, and swaps ask nothing
  setAdvancedRespec(on: boolean): void;
  enhAtCap: boolean; // Max Slot/Build Level (browser setting): pieces go in at the highest level the build can use, and rise with it
  setEnhAtCap(on: boolean): void;
  /**
   * Open a build from outside (link, saved, import) with its own game version's data.
   *
   * @raise ImportProblem when the build is refused (checkBuild); another Error when its game data
   *   won't load (a fault on the planner's side).
   */
  openBuild(b: Build): Promise<void>;
  /**
   * openBuild(), telling the user in the dialog when the build can't be opened.
   *
   * @return Whether it opened.
   */
  loadBuild(b: Build): Promise<boolean>;
}

const STORAGE_KEY = 'hcp.current';
const NOTES_KEY = 'hcp.patchNotes';

/**
 * The resume button's label, in the two parts the button keeps apart: a long build name is cut
 * short to fit, the server it continues on never is.
 */
export interface ResumeLabel {
  build: string; // 'Continue "Fire Guy"', or 'Continue your last build' for one without a name
  server: string; // 'on Thunderspy'
}

/** What the server list answers when its resume button (continue the last build) is used. */
export const CONTINUE_BUILD = ':continue';

// whether this page load comes after a long break (read once, before any input here counts as a use)
const AWAY_AT_LOAD = returning(Date.now());
// the answer to the return question, once given: Try again on the error screen keeps it
let returnAnswer: string | null = null;

/** @return What ties patch notes to one build (they are dropped when another build opens; a rename keeps them). */
function buildTag(b: Build): string {
  return [...(b.server ? [b.server] : []), b.dataVersion, b.at, b.primary, b.secondary].join('|');
}

/** Remember (or forget) the current build's patch notes for this tab. */
function persistNotes(n: PatchNotes | null, b: Build | undefined): void {
  try {
    if (n && b) sessionStorage.setItem(NOTES_KEY, JSON.stringify({ ...n, tag: buildTag(b) }));
    else sessionStorage.removeItem(NOTES_KEY);
  } catch {
    /* storage unavailable: the notes last until the page closes */
  }
}

/** @return This tab's remembered patch notes, when they belong to this build. */
function restoreNotes(b: Build): PatchNotes | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(NOTES_KEY) ?? 'null') as (PatchNotes & { tag?: string }) | null;
    if (!raw || raw.tag !== buildTag(b) || typeof raw.title !== 'string' || !Array.isArray(raw.lines)) return null;
    return { title: raw.title, lines: raw.lines.filter((l): l is string => typeof l === 'string') };
  } catch {
    return null;
  }
}

// one fetch of each server's version list per page (revalidated on every visit: see loadVersions)
const versionCache = new Map<string, Promise<GameVersions>>();
function versionsFor(s: GameServer): Promise<GameVersions> {
  let p = versionCache.get(s.id);
  if (!p) {
    p = loadVersions(dataRoot(s, import.meta.env.BASE_URL));
    p.catch(() => versionCache.delete(s.id)); // a failed fetch may be retried
    versionCache.set(s.id, p);
  }
  return p;
}

/**
 * The server a decoded share code opens on: the one its address names, else the one its game
 * version belongs to (`versionServer`: the id's prefix tells it, so nothing is downloaded and a link
 * never fails because another server's files won't load).
 *
 * A link from before versions carries none and opens on the address's server, else Homecoming; an
 * older saved build's data id counts as Homecoming's i28p4.
 *
 * @param named What the link's address says about its server.
 * @param version The code's game version.
 * @return The server's id, or undefined for Homecoming.
 * @raise ImportProblem when the address names one server and the version another's: a Thunderspy
 *   code is never decoded against Homecoming's ids.
 */
export function shareServer(named: { server?: GameServer }, version: string | undefined): string | undefined {
  const made = version ? versionServer(normalizeVersion(version)) : undefined;
  if (named.server && made && made.id !== named.server.id) throw wrongServer(made, named.server);
  return (named.server ?? made)?.id;
}

// one fetch per game version per page: switching back to a version already seen is instant
const dataCache = new Map<string, Promise<GameData>>();
function dataFor(s: GameServer, v: GameVersion): Promise<GameData> {
  const key = `${s.id}/${v.id}`;
  let p = dataCache.get(key);
  if (!p) {
    p = loadGameData(s, import.meta.env.BASE_URL, v);
    p.catch(() => dataCache.delete(key)); // a failed fetch may be retried
    dataCache.set(key, p);
  }
  return p;
}

/**
 * Start loading a server's game data in the background (the server list's likely pick), so the
 * screen behind it shows sooner once it is picked. The caches above keep it; a failure is dropped
 * from them and left for the real load to report.
 *
 * @param s The server.
 * @param version The game version a build asks for (its default when none or unknown).
 */
function prefetch(s: GameServer, version?: unknown): void {
  versionsFor(s)
    .then((vs) => dataFor(s, resolveVersion(vs, typeof version === 'string' ? version : undefined).version))
    .catch(() => undefined);
}

/**
 * The server a build is for.
 *
 * @param b The build.
 * @return Its server.
 * @raise ImportProblem when the site doesn't carry it.
 */
function buildServer(b: Build): GameServer {
  const s = serverById(serverOf(b));
  if (!s) throw unknownServer(String(b.server));
  return s;
}

/** @return The server whose data is shown. */
function shownServer(): GameServer {
  return serverById(useStore.getState().server) ?? defaultServer();
}

/** Say so when a build asked for a game version this site no longer has. */
function missingNote(missing: string | undefined, used: GameVersion): string | undefined {
  return missing ? missingVersionNote(missing, used) : undefined;
}

/**
 * Remember the build: per tab (sessionStorage, so two tabs hold two builds) and as the browser's
 * most recent build (localStorage, what a brand-new tab starts from). The address bar carries it
 * too (see the #b= sync below).
 */
function persist(b: Build | undefined): void {
  if (!b) return;
  const raw = JSON.stringify(b);
  try {
    sessionStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* storage unavailable (private mode) */
  }
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* storage unavailable (private mode) -- the build just isn't remembered */
  }
}

/**
 * Forget a cleared build: this tab's copy, and the browser's most recent one when that is still
 * this tab's (another tab may have saved its own there since). The tab's saved copy is compared,
 * not the build in memory: some steps (Back while leveling) change the build without saving it.
 *
 * @param b The build being cleared, if any.
 */
function forget(b: Build | undefined): void {
  if (!b) return;
  let own: string | null = JSON.stringify(b);
  try {
    own = sessionStorage.getItem(STORAGE_KEY) ?? own;
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  try {
    if (localStorage.getItem(STORAGE_KEY) === own) localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** @return The remembered builds: this tab's, then the browser's most recent one (unchecked: see checkBuild). */
function storedBuilds(): Build[] {
  // even touching window.sessionStorage throws when site data is blocked, so the access itself is
  // inside the try
  const read = (get: () => Storage) => {
    try {
      const raw = get().getItem(STORAGE_KEY);
      const b: unknown = raw ? JSON.parse(raw) : undefined;
      return b && typeof b === 'object' ? [b as Build] : [];
    } catch {
      return [];
    }
  };
  return [...read(() => sessionStorage), ...read(() => localStorage)];
}

/**
 * @param accept Which remembered builds may open (one for the server the address names).
 * @return This tab's build, else the browser's most recent one, the first `accept` takes
 *   (unchecked: see checkBuild).
 */
function restore(accept: (b: Build) => boolean = () => true): Build | undefined {
  return storedBuilds().find((b) => {
    try {
      return accept(b);
    } catch {
      return false;
    }
  });
}

/**
 * The build this browser remembers (this tab's, else the most recent), when it has a power picked.
 *
 * Whatever would replace it while it isn't open asks first (askOverRemembered): after the return
 * question's tile, or at another server's address, it is still remembered but nothing on screen
 * shows it.
 *
 * @return It (unchecked: open it through loadBuild), or undefined.
 */
export function rememberedBuild(): Build | undefined {
  const b = restore();
  // one with a power picked: checkBuild refuses to open a build without any, so there is nothing
  // to offer back (the same test the return question uses)
  return b && hasPicks(b) ? b : undefined;
}

/**
 * Ask before something replaces the build this browser remembers while no build is open: go ahead,
 * open the remembered build instead, or stay.
 *
 * A new build, an import, a saved build or a link pasted into the address bar all become the
 * remembered build, and the one remembered now is kept nowhere else unless the player saved or
 * bookmarked it. An open build's own question is the caller's: this asks only when none is open.
 *
 * @param title The question's title ("Start a new build?").
 * @param what What replaces it, starting a sentence ('A new build', 'Loading "Fire Guy"').
 * @param okLabel The button that goes ahead ("Start new", "Replace").
 * @return 'go' to go ahead (also when a build is open or nothing is remembered); 'cancel' when the
 *   player stayed; 'opened' when the remembered build was opened instead; 'replaced' when a newer
 *   dialog took the question's place before any answer (nothing was decided).
 */
export async function askOverRemembered(title: string, what: string, okLabel: string): Promise<'go' | 'cancel' | 'opened' | 'replaced'> {
  if (useStore.getState().build) return 'go';
  const old = rememberedBuild();
  if (!old) return 'go';
  const named = cleanName(old.name);
  const answer = await useStore.getState().askThreeWay({
    title,
    text: `This browser still remembers your last build${named ? ` "${named}"` : ''}. ${what} replaces it. Open your last build to keep working on it, or to save it first (Saved builds / Import).`,
    okLabel,
    altLabel: 'Open it',
  });
  if (answer === 'alt') {
    await useStore.getState().loadBuild(old);
    return 'opened';
  }
  return answer === 'ok' ? 'go' : answer;
}

/**
 * Whether a share link holds this browser's own remembered build (the address keeps the open
 * build's code, so a reloaded tab's link is its own build, not one someone sent).
 *
 * @param code The link's share code.
 * @param server The server the link opens on.
 * @return True when it is the code of a remembered build for that server.
 */
async function isRemembered(code: string, server: string): Promise<boolean> {
  for (const b of storedBuilds()) {
    try {
      if (serverOf(b) === server && (await encodeShare(b)) === code) return true;
    } catch {
      /* a damaged remembered build is nobody's code */
    }
  }
  return false;
}

/** @return Whether a remembered build has a power picked (one with none is nothing to continue: checkBuild drops it). */
function hasPicks(b: Build): boolean {
  return Array.isArray(b.picks) && b.picks.some((p) => p);
}

/** @return The resume button's label for a build ('Continue "Fire Guy"', 'on Thunderspy'). */
function resumeLabel(b: Build, server: GameServer): ResumeLabel {
  const name = cleanName(b.name).trim();
  return { build: name ? `Continue "${name}"` : 'Continue your last build', server: `on ${server.label}` };
}

// selectServer calls in flight: only the newest may show its server
let serverSeq = 0;

/** @return The steps the level-up flow walks: a Respec's own order, else the leveling steps. */
export function stepsOf(steps: LevelStep[], l: LevelCtx): LevelStep[] {
  return l.flow ?? steps;
}

/** @return The pick index the flow is on (power steps only). */
export function currentPick(steps: LevelStep[], l: LevelCtx): number {
  return stepsOf(steps, l)[l.step]?.picks[l.pickInStep] ?? -1;
}

/**
 * Give each slot placed on a step its level. Outside a respec that is the step's level; a respec
 * screen merges several slot levels, and each slot takes the lowest one its power is owned at.
 *
 * @param step The step the slots are placed on.
 * @param owned For each slot, the level its power was taken.
 * @param taken Levels already held by slots kept on the screen (ones holding enhancements stay
 *   put when it is reopened): not handed out again.
 * @return One level per slot, in the same order.
 */
function spreadSlots(step: LevelStep, owned: number[], taken: number[] = []): number[] {
  if (!step.slotLevels) return owned.map(() => step.level);
  const free = [...step.slotLevels];
  for (const lv of taken) {
    const k = free.indexOf(lv);
    if (k >= 0) free.splice(k, 1);
  }
  return lowestFreeLevels(free, owned, step.level);
}

/** Build with this level's pending choices applied (what the screens draw). */
export function previewBuild(gd: GameData, steps: LevelStep[], l: LevelCtx): Build {
  const step = stepsOf(steps, l)[l.step];
  if (!step) return l.base;
  if (l.sub === 'slots') {
    let b = l.base;
    const entries = new BuildRules(gd, b).entries();
    const pending = l.pendingSlots.map((key) => entries.find((x) => x.key === key));
    const span = new Set(step.slotLevels ?? []);
    // a freed-slot screen offers exactly the freed levels: other slots at those levels aren't its own
    const taken = l.freed ? [] : entries.flatMap((x) => x.slots.filter((sl, i) => i > 0 && span.has(sl.level)).map((sl) => sl.level));
    const levels = spreadSlots(step, pending.map((e) => e?.level ?? 0), taken);
    pending.forEach((e, i) => {
      if (e) b = addSlot(b, e.key, levels[i]!, e.level);
    });
    return b;
  }
  const pick = currentPick(steps, l);
  // editing a level from the overview: the pick's slots and enhancements come from the original
  const carry = l.mode === 'edit' ? l.orig.picks[pick] : undefined;
  return l.pendingPower !== undefined && pick >= 0 ? setPick(gd, l.base, pick, l.pendingPower, carry) : l.base;
}

/**
 * Remove a level's choices so it can be redone: the pick itself, or slots gained at the level.
 *
 * @param keepEnhanced Keep slots that hold an enhancement (reopening a slot level: they stay
 *   placed and locked; only empty slots can be moved).
 * @param order Pick indices in the order the flow asks them (default: index order).
 */
function withoutLevel(b: Build, step: LevelStep, pick: number | null, dropLater: boolean, keepEnhanced = false, order?: number[]): Build {
  const nb = cloneBuild(b);
  const levels = stepSlotLevels(step);
  const first = Math.min(...levels);
  // "later" follows the flow's own order (a respec asks level 1's pick 1 before pick 0)
  const rank = (i: number) => (order ? order.indexOf(i) : i);
  if (pick !== null) nb.picks = nb.picks.map((p, i) => (i === pick || (dropLater && rank(i) > rank(pick)) ? null : p));
  else if (dropLater) nb.picks = nb.picks.map((p) => (p && p.level > step.level ? null : p));
  const drop = (lvl: number) => (dropLater ? lvl >= first : levels.includes(lvl));
  const filt = <T extends { level: number; enh?: unknown }>(slots: T[]) => slots.filter((s, i) => i === 0 || !drop(s.level) || (keepEnhanced && !!s.enh));
  for (const p of nb.picks) if (p) p.slots = filt(p.slots);
  for (const g of Object.values(nb.granted)) g.slots = filt(g.slots);
  return nb;
}

/** @return Entry keys of the slots gained at these levels, one per slot (only empty ones if asked). */
function slotKeysAt(gd: GameData, b: Build, levels: number[], emptyOnly = false): string[] {
  const keys: string[] = [];
  for (const e of new BuildRules(gd, b).entries()) {
    e.slots.forEach((s, i) => {
      if (i > 0 && levels.includes(s.level) && !(emptyOnly && s.enh)) keys.push(e.key);
    });
  }
  return keys;
}

/** @return Whether undoing a level (and, with dropLater, everything after it) would discard an enhancement. */
function dropsEnhancements(gd: GameData, b: Build, step: LevelStep, pick: number | null, dropLater: boolean, order?: number[]): boolean {
  const after = withoutLevel(b, step, pick, dropLater, false, order);
  const count = (x: Build) => new BuildRules(gd, x).entries().reduce((n, e) => n + e.slots.filter((s) => s.enh).length, 0);
  return count(after) < count(b);
}

/**
 * A power offered again on its pick's screen (Back, a level reopened from the overview), with the
 * pool or epic set it needs shown.
 *
 * The screen lists only the pool and epic sets the build owns without this pick, so a pick that
 * was the build's only power from its set brings the set along, as one chosen on the set picker.
 *
 * @param gd Game data.
 * @param base The build without the pick.
 * @param pick The pick.
 * @param power The power it held, if any.
 * @return The flow's pending power, and its set when the screen wouldn't list it.
 */
function offerAgain(gd: GameData, base: Build, pick: number, power: number | undefined): Pick<LevelCtx, 'pendingPower' | 'pendingSet'> {
  const set = power !== undefined ? gd.setOfPower.get(power)?.set : undefined;
  if (!set) return { pendingPower: power };
  const rules = new BuildRules(gd, base);
  const kind = rules.setKind(set);
  // setOptions lists a pool or epic set exactly when the build owns it at the pick without the pick
  const listed = (kind !== 'pool' && kind !== 'epic') || rules.ownedSets(rules.ownedAt(rules.pickLevel(pick), pick)).has(set.id);
  return listed ? { pendingPower: power } : { pendingPower: power, pendingSet: set.id };
}

const LOCKED = 'Remove enhancements first';

/** @return A browser setting switch (off when unset or storage is unavailable). */
function readSwitch(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Remember a browser setting switch (kept for this page only when storage is unavailable). */
function writeSwitch(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** @return The build as it reaches the overview from leveling: its pieces raised to the cap when Max Slot/Build Level is on. */
function atOverview(gd: GameData, b: Build): Build {
  return useStore.getState().enhAtCap ? raiseToCap(gd, b) : b;
}

/**
 * How a power swap's question names an enhancement: "Unbreakable Guard: Resistance (50)",
 * "Invention: Recharge Reduction (50)", with the power it sits in when that isn't the pick itself
 * (a power the old one granted).
 *
 * @param gd Game data.
 * @param b The build before the swap.
 * @param p The piece.
 * @param pickKey The swapped pick's entry key.
 * @return The line.
 */
function swapPieceLabel(gd: GameData, b: Build, p: SwapPiece, pickKey: string): string {
  const boost = gd.powerById.get(p.enh.boost);
  if (!boost) return 'Unknown enhancement';
  const ref = gd.boostSetOf.get(boost.id);
  // a set piece's name drops its set's ("Resistance"); others carry their kind ("Invention: Damage")
  const name = ref ? `${ref.set.dn}: ${pieceName(boost, ref.set.dn) || boost.dn}` : boost.dn;
  const rel = p.enh.rel ?? 0;
  const label = boost.bup ? 'Attuned' : boost.bie ? (p.enh.ioLevel !== undefined ? String(p.enh.ioLevel + 1) : '') : rel > 0 ? `+${rel}` : rel < 0 ? String(rel) : '';
  const where = p.key === pickKey ? '' : ` (in ${new BuildRules(gd, b).entries().find((e) => e.key === p.key)?.power.dn ?? 'a granted power'})`;
  return `${name}${label ? ` (${label})` : ''}${where}`;
}

/** @return Levels as a phrase: "3", "3 and 5", "3, 5 and 7" (1-based). */
function levelList(levels: number[]): string {
  const n = levels.map((l) => String(l + 1));
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : (n[0] ?? '');
}

/** @return The Music switch when the browser remembers none: off on phones (the phone layout), on elsewhere. */
function defaultMusic(): boolean {
  try {
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return !stageLayout(window.innerWidth, window.innerHeight, touch).dims.phone;
  } catch {
    return true;
  }
}

/** @return Whether a step's picks are made and its slots (if it grants any) are all placed. */
function stepDone(rules: BuildRules, b: Build, s: LevelStep): boolean {
  return s.picks.every((k) => b.picks[k]) && (s.slots === 0 || rules.slotsLeft(stepSlotLevels(s)) <= 0);
}

/**
 * Where Continue Leveling / Continue Respec picks up: the first level that isn't finished (the one
 * after the stop level when everything up to it is done); an unfinished respec where it stopped
 * (powers, then slots), after which leveling goes on.
 *
 * @param gd Game data.
 * @param b The build.
 * @param steps The leveling steps.
 * @return The respec flow (undefined when leveling), the step's index in it and the step; null
 *   when every step is done.
 */
export function continueTarget(gd: GameData, b: Build, steps: LevelStep[]): { flow: LevelStep[] | undefined; step: number; target: LevelStep } | null {
  const rules = new BuildRules(gd, b);
  const rflow = b.respecTo !== undefined ? respecSteps(steps, b.respecTo) : undefined;
  const ri = rflow ? rflow.findIndex((s) => !stepDone(rules, b, s)) : -1;
  const flow = ri >= 0 ? rflow : undefined;
  const step = flow ? ri : steps.findIndex((s) => !stepDone(rules, b, s));
  return step < 0 ? null : { flow, step, target: (flow ?? steps)[step]! };
}

/** @return Whether a Respec build still has powers or slots to place (it offers Continue Respec). */
export function respecUnfinished(gd: GameData, b: Build, steps: LevelStep[]): boolean {
  if (b.respecTo === undefined) return false;
  const rules = new BuildRules(gd, b);
  return respecSteps(steps, b.respecTo).some((s) => !stepDone(rules, b, s));
}

/**
 * Finish a pick reopened from the overview: swap its power (swapPick), asking first when that drops
 * enhancements or frees slots (never in Advanced Respec), then show the overview, or the slot
 * screen when slots were freed. Cancel leaves the player on the power screen.
 *
 * @param gd Game data.
 * @param steps The leveling steps.
 * @param level The power screen's state (edit mode).
 */
async function finishSwap(gd: GameData, steps: LevelStep[], level: LevelCtx): Promise<void> {
  const pick = currentPick(steps, level);
  const power = level.pendingPower;
  if (power === undefined || pick < 0) return;
  const old = level.orig.picks[pick];
  const sw = swapPick(gd, level.orig, pick, power);
  const st = useStore.getState();
  const advanced = st.advancedRespec && level.orig.respecTo !== undefined;
  if (old && !advanced && (sw.dropped.length || sw.freed.length)) {
    const from = gd.power(old.power).dn;
    const to = gd.power(power).dn;
    const key = `pick:${pick}`;
    const label = (p: SwapPiece) => swapPieceLabel(gd, level.orig, p, key);
    // a kept piece the game would refuse in the new power stays (flagged in red on the overview): say so
    const after = new BuildRules(gd, sw.build);
    const entry = after.entries().find((e) => e.key === key);
    const keptLabel = (p: SwapPiece) => {
      const why = entry ? after.enhRefusal(entry, p.slot, p.enh) : null;
      return why ? `${label(p)} - kept, but flagged: ${why}` : label(p);
    };
    const n = sw.freed.length;
    const frees = `${n} enhancement slot${n > 1 ? 's' : ''} (gained at level ${levelList(sw.freed)}). You'll place ${n > 1 ? 'them' : 'it'} next.`;
    const intro = `Changing ${from} to ${to} for the level ${(gd.core.schedule.power[pick] ?? 0) + 1} power choice`;
    const sections = sw.dropped.length
      ? [
          { heading: '', lines: sw.dropped.map(label) },
          ...(sw.kept.length ? [{ heading: 'The following enhancements will be kept:', lines: sw.kept.map(keptLabel) }] : []),
          ...(n ? [{ heading: `It also frees ${frees}`, lines: [] }] : []),
        ]
      : undefined;
    const ok = await st.askConfirm({
      title: 'Change power?',
      text: sw.dropped.length ? `${intro} will drop the following enhancements:` : `${intro} frees ${frees}`,
      sections,
      highlight: [from, to],
      okLabel: 'OK',
    });
    // Cancel (or a newer dialog) stays on the power screen; so does a screen that moved on meanwhile
    if (!ok || useStore.getState().level !== level) return;
  }
  if (sw.freed.length) {
    // one screen for the freed slots, each keeping its own level (previewBuild spreads them)
    const step: LevelStep = { level: Math.max(...sw.freed), picks: [], slots: sw.freed.length, slotLevels: sw.freed };
    useStore.setState({ level: { step: 0, pickInStep: 0, mode: 'edit', sub: 'slots', base: sw.build, orig: level.orig, pendingSlots: [], flow: [step], freed: true } });
    return;
  }
  persist(sw.build);
  useStore.setState({ build: sw.build, view: 'overview', level: undefined });
}

export const useStore = create<Store>((set, get) => ({
  // the address's server from the start, so the logo and footer don't show another one while loading
  server: (typeof location !== 'undefined' ? serverFromPath(location.pathname, import.meta.env.BASE_URL).server : undefined)?.id ?? defaultServer().id,
  serverAsk: null,
  askServer(cancellable, preselect, resume) {
    get().serverAsk?.resolve(null); // a newer question replaces an unanswered one
    return new Promise<string | null>((resolve) => set({ serverAsk: { cancellable, preselect, resume, resolve } }));
  },
  closeServerAsk(id) {
    const a = get().serverAsk;
    if (!a) return;
    set({ serverAsk: null });
    a.resolve(id);
  },
  async selectServer(id) {
    const s = serverById(id);
    if (!s || get().view !== 'setup') return false;
    const seq = ++serverSeq;
    try {
      const versions = await versionsFor(s);
      const gd = await dataFor(s, resolveVersion(versions, undefined).version);
      // left New Build while it loaded, or a newer switch was asked for
      if (get().view !== 'setup' || seq !== serverSeq) return false;
      forget(get().build);
      persistNotes(null, undefined);
      set({ server: s.id, versions, gd, steps: levelSteps(gd.core), build: undefined, patchNotes: null, menuOpen: false });
      return true;
    } catch (e) {
      // in plain words: the details go to the console
      console.error(`couldn't load ${s.id}'s game data`, e);
      get().notify(`Couldn't load ${s.label}'s game data. Check your connection, then try again.`);
      return false;
    }
  },
  steps: [],
  view: 'loading',
  muted: (() => {
    try {
      return localStorage.getItem('hcp.muted') === '1';
    } catch {
      return false;
    }
  })(),
  musicOn: (() => {
    try {
      const v = localStorage.getItem('hcp.music');
      return v === null ? defaultMusic() : v !== '0';
    } catch {
      return defaultMusic();
    }
  })(),

  menuOpen: false,
  advancedRespec: readSwitch('hcp.advancedRespec'),
  setAdvancedRespec(on) {
    writeSwitch('hcp.advancedRespec', on);
    set({ advancedRespec: on });
  },
  enhAtCap: readSwitch('hcp.enhAtCap'),
  setEnhAtCap(on) {
    writeSwitch('hcp.enhAtCap', on);
    set({ enhAtCap: on });
  },
  setupAlign: 'Hero',
  lockFlash: null,
  poolsBlinked: false,
  epicBlinked: false,
  patchNotes: null,
  setPatchNotes(n) {
    persistNotes(n, get().build);
    set({ patchNotes: n });
  },
  async dataForVersion(id) {
    const v = get().versions?.versions.find((x) => x.id === id);
    if (!v) throw new Error(`game version ${id} is not available`);
    return dataFor(shownServer(), v);
  },
  confirm: null,
  askConfirm(q) {
    // a newer question replaces an unanswered one (a countdown message: once it closes)
    return afterCountdown(() => {
      get().confirm?.resolve(false, undefined, /*replaced=*/ true);
      return new Promise<boolean>((resolve) => set({ confirm: { ...q, resolve: (answer) => resolve(answer === true) } }));
    });
  },
  askThreeWay(q) {
    return afterCountdown(() => {
      get().confirm?.resolve(false, undefined, /*replaced=*/ true);
      return new Promise<'ok' | 'alt' | 'cancel' | 'replaced'>((resolve) =>
        set({ confirm: { ...q, resolve: (answer, _picked, replaced) => resolve(answer === true ? 'ok' : answer === 'alt' ? 'alt' : replaced ? 'replaced' : 'cancel') } }),
      );
    });
  },
  askChoices(q) {
    return afterCountdown(() => {
      get().confirm?.resolve(false, undefined, /*replaced=*/ true);
      return new Promise<string[] | null>((resolve) =>
        set({ confirm: { ...q, choices: q.choices.map((c) => ({ ...c })), resolve: (answer, picked) => resolve(answer === true ? (picked ?? []) : null) } }),
      );
    });
  },
  tell({ wait, ...q }) {
    return afterCountdown(() => {
      get().confirm?.resolve(false, undefined, /*replaced=*/ true);
      const waitUntil = wait ? performance.now() + wait * 1000 : undefined;
      return new Promise<void>((resolve) => set({ confirm: { ...q, alert: true, okLabel: 'OK', waitUntil, resolve: () => resolve() } }));
    });
  },
  setConfirmChoice(row, id) {
    const c = get().confirm;
    const opt = c?.choices?.[row]?.options.find((o) => o.id === id);
    if (!c || !opt || opt.block !== undefined) return;
    set({ confirm: { ...c, choices: c.choices!.map((x, i) => (i === row ? { ...x, value: id } : x)) } });
  },
  closeConfirm(answer) {
    const c = get().confirm;
    if (!c) return;
    if (c.waitUntil !== undefined && performance.now() < c.waitUntil) return; // a countdown can't be skipped
    if (answer === 'alt' && c.altLabel === undefined) return; // only askThreeWay has a second way
    set({ confirm: null });
    c.resolve(answer, c.choices?.map((x) => x.value));
  },
  flashLocked(key, label = 'Remove Enhancements First!') {
    const id = (get().lockFlash?.id ?? 0) + 1;
    // loaded lazily: the sound module imports this store, so a static import would be circular
    void import('../ui/sound.ts').then((m) => m.play('reject5'));
    set({ lockFlash: { id, key, label } });
    window.setTimeout(() => {
      if (get().lockFlash?.id === id) set({ lockFlash: null });
    }, 1600);
  },
  notice: null,
  notify(text) {
    const id = (get().notice?.id ?? 0) + 1;
    set({ notice: { id, text } });
    window.setTimeout(() => {
      if (get().notice?.id === id) set({ notice: null });
    }, 3200); // the phone toast's stay (index.css .phone-toast); desktop's text fades by 2.2s
  },
  dismissNotice() {
    set({ notice: null });
  },
  tips: (() => {
    try {
      const v = localStorage.getItem('hcp.tooltips') as TipMode | null;
      return v && TIP_MODES.includes(v) ? v : 'enabled';
    } catch {
      return 'enabled';
    }
  })(),
  shift: false,

  setTips(m) {
    try {
      localStorage.setItem('hcp.tooltips', m);
    } catch {
      /* ignore */
    }
    set({ tips: m });
  },

  setMenu(open) {
    set({ menuOpen: open });
  },

  async selectVersion(id) {
    const { versions, gd } = get();
    const v = versions?.versions.find((x) => x.id === id);
    if (!v) return false;
    if (gd?.core.manifest.dataVersion === id) return true;
    const server = shownServer();
    try {
      const data = await dataFor(server, v);
      if (get().server !== server.id) return false; // the server changed while it loaded
      set({ gd: data, steps: levelSteps(data.core) });
      return true;
    } catch (e) {
      console.error(`couldn't load ${server.id}/${v.id}`, e);
      get().notify(`Couldn't load ${v.label}'s game data. Check your connection, then try again.`);
      return false;
    }
  },

  async openBuild(b) {
    const server = buildServer(b);
    const versions = await versionsFor(server);
    const { version, missing } = resolveVersion(versions, b.dataVersion);
    const gd = await dataFor(server, version);
    // checked before it replaces anything: an unusable build is refused, a repairable one repaired
    const { build: nb, fixes } = checkBuild(gd, b);
    if (!nb) throw refusedBuild(fixes);
    if (fixes.length) console.warn('build repaired:', fixes);
    persist(nb);
    persistNotes(null, undefined);
    set({ server: server.id, versions, gd, steps: levelSteps(gd.core), build: nb, view: 'overview', level: undefined, menuOpen: false, poolsBlinked: false, epicBlinked: false, patchNotes: null });
    warnInvalidPair();
    const note = missingNote(missing, version);
    if (note) get().notify(note);
  },

  async loadBuild(b) {
    try {
      await get().openBuild(b);
      return true;
    } catch (e) {
      const f = describeImportFailure(e, "Couldn't open that build", "Couldn't open the build");
      await get().tell({ title: f.title, text: f.text });
      return false;
    }
  },

  async load() {
    try {
      // the server the address names (/HatesCoHPlanner/Homecoming/), if any
      const named = serverFromPath(location.pathname, import.meta.env.BASE_URL);
      // every build from outside the app is checked (and repaired where safe) against its own game
      // version's data before it is used or saved again: a share link (#b=...) first, else this
      // tab's / the browser's remembered build. A link is for the server its address names (one
      // naming none is Homecoming's); a remembered build for another server than the address
      // names is left for that server's address.
      const link = /#b=([A-Za-z0-9_-]+)/.exec(location.hash);
      const candidates: (() => Promise<Build | undefined>)[] = [
        async () => {
          if (!link) return undefined;
          // an address naming a server the site doesn't carry: never open its link on another's data
          if (named.unknown) throw unknownServer(named.unknown);
          const code = await decodeShare(link[1]!);
          return withServer(code, shareServer(named, code.dataVersion));
        },
        async () => restore((r) => !named.server || serverOf(r) === named.server.id),
      ];
      let linkFailed: unknown; // why the address's share link couldn't be opened, if it couldn't
      let lastFailed: unknown; // why the remembered build couldn't be opened, if it couldn't
      // a bad link falls back to the remembered build, then says so
      const tellLink = (opened: boolean) => {
        if (linkFailed === undefined) return;
        const f = describeImportFailure(linkFailed, "The share link in the page's address couldn't be opened", "Couldn't open the share link");
        void get().tell({ title: f.title, text: opened ? `${f.text}\nYour last build is open instead.` : f.text });
      };
      let linkFor: string | undefined; // the server the address's link was decoded for, when it was
      let asked = false; // the return question (below) is asked once per load
      let fresh: GameServer | undefined; // the server it picked for a new build instead
      let continued: GameServer | undefined; // the server of the build it was told to continue
      for (const [k, next] of candidates.entries()) {
        let raw: Build | undefined;
        try {
          raw = await next();
        } catch (e) {
          if (k === 0) linkFailed = e;
          continue;
        }
        if (!raw) continue;
        if (k === 0) linkFor = serverOf(raw);
        const server = serverById(serverOf(raw));
        if (!server) {
          if (k === 0) linkFailed = unknownServer(String(raw.server));
          continue;
        }
        // after a long break the player's own build (this browser's remembered one, or the link a
        // reloaded tab keeps in its address) doesn't reopen unannounced: the server list asks first,
        // with a button that continues it. A link someone sent opens as always.
        if (AWAY_AT_LOAD && !asked && SERVERS.length > 1 && hasPicks(raw) && (k === 1 || (await isRemembered(link?.[1] ?? '', server.id)))) {
          asked = true;
          prefetch(server, raw.dataVersion); // what Continue opens
          const id = returnAnswer ?? (await get().askServer(/*cancellable=*/ false, (named.server ?? lastServer() ?? server).id, resumeLabel(raw, server)));
          if (id === null) return; // a newer load() asked again (React's dev double mount): it carries on
          returnAnswer = id;
          if (id !== CONTINUE_BUILD) {
            fresh = serverById(id);
            // New Build: the address no longer carries the build (it stays remembered until a new one starts)
            if (k === 0 && typeof history !== 'undefined') history.replaceState(history.state, '', `${location.pathname}${location.search}`);
            break;
          }
          continued = server;
        }
        const versions = await versionsFor(server);
        const { version, missing } = resolveVersion(versions, typeof raw.dataVersion === 'string' ? raw.dataVersion : undefined);
        let gd: GameData;
        try {
          gd = await dataFor(server, version);
        } catch (e) {
          // that version's data won't load (a network hiccup): try the next build, then New Build,
          // rather than stopping on the error screen
          console.error(`couldn't load ${server.id}/${version.id} for a remembered build`, e);
          if (k === 0) linkFailed = e;
          else lastFailed = e;
          continue;
        }
        const c = checkBuild(gd, raw);
        if (!c.build) {
          // a build started but with no power picked yet (the address keeps it from New Build's
          // first screen) is nothing to open, not a broken link
          if (k === 0 && c.fixes[c.fixes.length - 1] !== 'no powers picked yet') linkFailed = refusedBuild(c.fixes);
          else if (k === 1) lastFailed = refusedBuild(c.fixes);
          continue;
        }
        if (c.fixes.length) console.warn('saved build repaired:', c.fixes);
        persist(c.build);
        set({ server: server.id, versions, gd, steps: levelSteps(gd.core), build: c.build, view: 'overview', patchNotes: restoreNotes(c.build) });
        warnInvalidPair();
        const note = missingNote(missing, version);
        if (note) get().notify(note);
        tellLink(true);
        return;
      }
      // asked to continue a build that then couldn't open: say so (a link already says why), and show
      // New Build on its server rather than asking again
      if (continued && linkFailed === undefined && lastFailed !== undefined) {
        const f = describeImportFailure(lastFailed, "Your last build couldn't be opened", "Couldn't open your last build");
        void get().tell({ title: f.title, text: f.text });
      }
      // no build: New Build on the server picked above, else the one the address names; else, for a
      // link refused for what it holds (damaged, another server's, a build checkBuild refuses), its
      // own server (the one its code was made on; for a damaged code the default, as for every link
      // at the site root before servers), where the reason is told; else, once the site carries more
      // than one, the player picks (the server last shown in this browser, else the default, is one
      // key press away, and its data loads while the list is open), so a link whose server's data
      // won't load leaves the other servers a click away; else the only one
      // (an address naming a server the site doesn't carry is never opened as another's: it asks)
      const refused = linkFailed instanceof ImportProblem && !named.unknown;
      let picked = fresh ?? continued ?? named.server ?? (refused ? (serverById(linkFor ?? '') ?? defaultServer()) : undefined);
      if (!picked && SERVERS.length > 1) {
        const likely = lastServer() ?? defaultServer();
        prefetch(likely);
        const id = await get().askServer(/*cancellable=*/ false, likely.id);
        if (id === null) return; // a newer load() asked again (React's dev double mount): it carries on
        picked = serverById(id);
      }
      picked ??= defaultServer();
      const versions = await versionsFor(picked);
      const gd = await dataFor(picked, resolveVersion(versions, undefined).version);
      // a link that couldn't open stays in the address for a reload to retry, but only on its own
      // server: shown on another (a bare Thunderspy code whose data didn't load, Homecoming picked)
      // the address would name the wrong server for it. At the site root it moves to its own
      // server's address, so the reload reads it for that server (a damaged code names none, and
      // stays only on the default server, where a link at the root is read).
      if (linkFailed !== undefined && typeof history !== 'undefined') {
        if (linkFor && linkFor !== picked.id) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
        else if (linkFor && link && !named.server && !named.unknown) {
          history.replaceState(history.state, '', `${serverHref(picked, import.meta.env.BASE_URL)}${location.search}${location.hash}`);
        }
      }
      set({ server: picked.id, versions, gd, steps: levelSteps(gd.core), build: undefined, view: 'setup' });
      tellLink(false);
    } catch (e) {
      set({ view: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  startBuild(args) {
    const { gd } = get();
    if (!gd) return;
    // the choices must belong to the data shown: New Build's may have been made on another server's
    // or version's data that replaced it meanwhile (each server numbers its archetypes and sets)
    const at = gd.archetypeById.get(args.at);
    const inCat = (cat: string | undefined, id: number) => !!cat && gd.setsInCategory(cat).some((s) => s.id === id);
    if (!at || !inCat(at.cats.pri, args.primary) || !inCat(at.cats.sec, args.secondary) || !gd.core.origins.some((o) => o.id === args.origin)) {
      get().notify('The game data changed while you chose: pick the archetype and power sets again.');
      return;
    }
    // an archetype whose training forces a respec (Arachnos Soldier and Widow) is planned as a
    // Respec build only, to that level at least (respecOnlyNote)
    const forced = levelUpRespec(gd, at);
    const respecTo = forced === undefined ? args.respecTo : Math.max(args.respecTo ?? MAX_LEVEL, forced);
    const b = newBuild({ ...args, respecTo, server: gd.server, dataVersion: gd.core.manifest.dataVersion, pickCount: gd.core.schedule.power.length });
    persist(b);
    persistNotes(null, undefined);
    const flow = respecTo !== undefined ? respecSteps(get().steps, respecTo) : undefined;
    set({
      build: b,
      view: 'level',
      level: { step: 0, pickInStep: 0, mode: 'wizard', sub: 'power', base: b, orig: b, pendingSlots: [], flow },
      poolsBlinked: false,
      epicBlinked: false,
      patchNotes: null,
    });
  },

  setBuild(b) {
    persist(b);
    set({ build: b });
  },

  toSetup() {
    set({ view: 'setup', level: undefined });
  },

  toOverview() {
    // the New Build screen may have switched to another game version or server: show the build's own again
    const { build, gd } = get();
    if (build && gd && (build.dataVersion !== gd.core.manifest.dataVersion || serverOf(build) !== gd.server)) {
      // the build already open, shown again: its invalid power sets warning isn't repeated
      reopening = build;
      reopens++;
      void get()
        .loadBuild(build)
        .finally(() => {
          if (--reopens === 0) reopening = undefined;
        });
      return;
    }
    set({ view: 'overview', level: undefined });
  },

  choosePower(power) {
    const { level, gd } = get();
    if (!level || !gd) return;
    // A new pool/epic set stays shown only while the chosen power belongs to it.
    const keepSet = power !== undefined && level.pendingSet !== undefined && gd.setOfPower.get(power)?.set.id === level.pendingSet;
    set({ level: { ...level, pendingPower: power, pendingSet: keepSet ? level.pendingSet : undefined } });
  },

  openSetPicker(kind) {
    const { level } = get();
    if (level) set({ level: { ...level, sub: kind } });
  },

  closeSetPicker(setId, power) {
    const { level } = get();
    if (!level) return;
    if (setId === undefined || power === undefined) {
      set({ level: { ...level, sub: 'power' } });
      return;
    }
    set({ level: { ...level, sub: 'power', pendingSet: setId, pendingPower: power } });
  },

  addPendingSlot(key) {
    const { level } = get();
    if (level) set({ level: { ...level, pendingSlots: [...level.pendingSlots, key] } });
  },

  removePendingSlot(index) {
    const { level } = get();
    if (level) set({ level: { ...level, pendingSlots: level.pendingSlots.filter((_, i) => i !== index) } });
  },

  finishLevel() {
    const { gd, steps, level } = get();
    if (!gd || !level) return;
    if (level.mode === 'edit' && level.sub === 'power') {
      void finishSwap(gd, steps, level);
      return;
    }
    const b = previewBuild(gd, steps, level);
    persist(b);
    if (level.mode === 'edit') {
      set({ build: b, view: 'overview', level: undefined });
      return;
    }
    // advance the wizard
    const flow = stepsOf(steps, level);
    let step = level.step;
    let pickInStep = level.pickInStep;
    const cur = flow[step];
    if (level.sub !== 'slots' && cur && pickInStep + 1 < cur.picks.length) {
      pickInStep++;
    } else if (level.sub !== 'slots' && cur && cur.slots > 0) {
      set({ build: b, level: { ...level, base: b, sub: 'slots', pendingPower: undefined, pendingSet: undefined, pendingSlots: [] } });
      return;
    } else {
      step++;
      pickInStep = 0;
    }
    const next = flow[step];
    if (!next) {
      const done = atOverview(gd, b);
      persist(done);
      set({ build: done, view: 'overview', level: undefined });
      return;
    }
    set({
      build: b,
      level: {
        step,
        pickInStep,
        mode: 'wizard',
        sub: next.picks.length ? 'power' : 'slots',
        base: b,
        orig: b,
        pendingSlots: [],
        flow: level.flow,
      },
    });
  },

  backLevel() {
    const { gd, steps, level, build } = get();
    if (!gd || !level || !build) return;
    if (level.mode === 'edit') {
      set({ view: 'overview', level: undefined, build: level.orig });
      return;
    }
    // previous position in the wizard
    const flow = stepsOf(steps, level);
    let step = level.step;
    let pickInStep = level.pickInStep;
    let sub: LevelSub = level.sub === 'slots' ? 'slots' : 'power';
    const cur = flow[step];
    if (sub === 'slots' && cur && cur.picks.length) {
      sub = 'power';
      pickInStep = cur.picks.length - 1;
    } else if (sub === 'power' && pickInStep > 0) {
      pickInStep--;
    } else {
      step--;
      const prev = flow[step];
      if (!prev) {
        set({ view: 'setup', level: undefined });
        return;
      }
      sub = prev.slots > 0 ? 'slots' : 'power';
      pickInStep = Math.max(0, prev.picks.length - 1);
    }
    const target = flow[step]!;
    const committed = level.base;
    // Back discards that level and everything after it: not while any of it holds enhancements
    const order = flow.flatMap((s) => s.picks);
    if (dropsEnhancements(gd, committed, target, sub === 'slots' ? null : target.picks[pickInStep]!, true, order)) {
      get().notify(LOCKED);
      return;
    }
    if (sub === 'slots') {
      const pending = slotKeysAt(gd, committed, stepSlotLevels(target));
      const base = withoutLevel(committed, target, null, true);
      set({ build: base, level: { step, pickInStep, mode: 'wizard', sub, base, orig: base, pendingSlots: pending, flow: level.flow } });
    } else {
      const pick = target.picks[pickInStep]!;
      const base = withoutLevel(committed, target, pick, true, false, order);
      const offer = offerAgain(gd, base, pick, committed.picks[pick]?.power);
      set({ build: base, level: { step, pickInStep, mode: 'wizard', sub, base, orig: base, ...offer, pendingSlots: [], flow: level.flow } });
    }
  },

  cancelLevel() {
    const { level } = get();
    if (level?.mode === 'edit') set({ view: 'overview', level: undefined, build: level.orig });
    else get().backLevel();
  },

  editPick(pickIndex) {
    const { build, steps } = get();
    if (!build) return;
    // a swap that drops enhancements or slots is asked about on Finish (finishSwap)
    const gd = get().gd;
    const step = steps.findIndex((s) => s.picks.includes(pickIndex));
    if (step < 0) return;
    const base = cloneBuild(build);
    base.picks[pickIndex] = null;
    const power = build.picks[pickIndex]?.power;
    set({
      view: 'level',
      level: {
        step,
        pickInStep: steps[step]!.picks.indexOf(pickIndex),
        mode: 'edit',
        sub: 'power',
        base,
        orig: build,
        ...(gd ? offerAgain(gd, base, pickIndex, power) : { pendingPower: power }),
        pendingSlots: [],
      },
    });
  },

  editSlots(lvl) {
    const { gd, build, steps } = get();
    if (!gd || !build) return;
    // a respec places its slots after every power is chosen: until then, Continue Respec
    const end = build.respecTo;
    if (end !== undefined && lvl <= end && build.picks.some((p, i) => !p && (gd.core.schedule.power[i] ?? 99) <= end)) {
      get().notify('Choose every power first: use Continue Respec');
      return;
    }
    // the slots booked at that level, as leveling reopens them (a respec's may move to any power:
    // BuildRules.slotsAnyPower); slots holding enhancements stay where they are (locked), only the
    // empty ones can move
    const step = steps.findIndex((s) => s.level === lvl && s.slots > 0);
    if (step < 0) return;
    const pending = slotKeysAt(gd, build, [lvl], true);
    const base = withoutLevel(build, steps[step]!, null, false, true);
    set({ view: 'level', level: { step, pickInStep: 0, mode: 'edit', sub: 'slots', base, orig: build, pendingSlots: pending } });
  },

  stopHere(openMenu) {
    // View Build / Save / Share mid-leveling: the build ends at this level (its choices so far
    // included) and the overview hides the levels after it
    const { gd, steps, level } = get();
    if (!gd || !level || level.mode !== 'wizard') return;
    const step = stepsOf(steps, level)[level.step];
    if (!step) return;
    const now = previewBuild(gd, steps, level);
    // a respec stopped on its slot screens has every power: it ends at its respec level
    const b = atOverview(gd, { ...now, endLevel: level.flow && !step.picks.length ? (now.respecTo ?? 49) : step.level });
    persist(b);
    set({ build: b, view: 'overview', level: undefined, menuOpen: openMenu });
  },

  continueLeveling() {
    const { gd, build, steps } = get();
    if (!gd || !build) return;
    const where = continueTarget(gd, build, steps);
    if (!where) return;
    const { flow, step, target } = where;
    const b = cloneBuild(build);
    if (flow) b.endLevel = build.respecTo! < 49 ? build.respecTo : undefined;
    else delete b.endLevel;
    persist(b);
    const firstPick = target.picks.findIndex((k) => !b.picks[k]);
    const sub: LevelSub = firstPick >= 0 ? 'power' : 'slots';
    const pendingSlots = sub === 'slots' ? slotKeysAt(gd, b, stepSlotLevels(target), true) : [];
    const base = sub === 'slots' ? withoutLevel(b, target, null, false, true) : b;
    set({
      build: base,
      view: 'level',
      level: { step, pickInStep: Math.max(0, firstPick), mode: 'wizard', sub, base, orig: base, pendingSlots, flow },
    });
  },

  setMuted(m) {
    try {
      localStorage.setItem('hcp.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ muted: m });
  },

  setMusicOn(on) {
    try {
      localStorage.setItem('hcp.music', on ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ musicOn: on });
  },
}));

/**
 * The page address for the app's state: the build's server's (its share code opens on that
 * server's data), or with no build the server the New Build screen shows.
 *
 * @param s The store's state.
 * @return The address path ("/HatesCoHPlanner/Homecoming/").
 */
function addressPath(s: { build?: Build; server: string }): string {
  const server = serverById(s.build ? serverOf(s.build) : s.server) ?? defaultServer();
  return serverHref(server, import.meta.env.BASE_URL);
}

// The address bar always carries this tab's build as a share code on its server's address
// (/HatesCoHPlanner/Homecoming/#b=...), replaced in place so edits don't pile up Back-button
// entries: a reload, a bookmark or a copied address brings back exactly this build, and two tabs
// keep two builds apart.
if (typeof window !== 'undefined') {
  let timer = 0;
  useStore.subscribe((s, prev) => {
    if (s.build === prev.build || !s.build) return;
    const b = s.build;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void encodeShare(b)
        .then((code) => {
          if (useStore.getState().build !== b) return;
          const want = `${addressPath(useStore.getState())}${location.search}#b=${code}`;
          // replaceState fires no hashchange, so this doesn't reload the build
          if (`${location.pathname}${location.search}${location.hash}` !== want) history.replaceState(history.state, '', want);
        })
        .catch(() => undefined);
    }, 300);
  });
  // with no build the address names the server shown (an old or bare address gains it). A share
  // code left in it (a link that couldn't open) stays only while the address still means the same
  // server: moved to another one, a reload would open it on the wrong data. A build cleared by a
  // server switch takes its share code with it, so a reload can't bring it back.
  useStore.subscribe((s, prev) => {
    // the error screen leaves the address as it was, so Try again and a reload read the same link
    // (the store's server there may only be the default: the address named none)
    if (s.build || s.view === 'loading' || s.view === 'error') return;
    const cleared = !!prev.build;
    if (!cleared && s.server === prev.server && prev.view !== 'loading') return;
    window.clearTimeout(timer); // a share code still being written for the cleared build
    const path = addressPath(s);
    const was = serverFromPath(location.pathname, import.meta.env.BASE_URL);
    const same = !was.unknown && (was.server?.id ?? DEFAULT_SERVER) === s.server;
    const hash = cleared || !same ? '' : location.hash;
    if (location.pathname !== path || location.hash !== hash) history.replaceState(history.state, '', `${path}${location.search}${hash}`);
  });
}

// A click, tap, key or wheel in any tab is a use: a page load after RETURN_AFTER without one asks
// before reopening the last build (see load)
if (typeof window !== 'undefined') trackUse(window);

// The logo's server list belongs to New Build: a build opening behind it (a link pasted into the
// address bar) closes it, since a pick there could no longer switch anything. So does a dialog
// opening while it is up (that link's question): the list draws above dialogs and takes Enter and
// Space, so the dialog's own keys would pick a server instead.
useStore.subscribe((s, prev) => {
  if (!s.serverAsk?.cancellable) return;
  if ((prev.view === 'setup' && s.view !== 'setup') || (s.confirm && !prev.confirm)) s.closeServerAsk(null);
});

// The server shown once the page is up (picked, switched to, or a build's) is the one the server
// list starts on next time
if (typeof window !== 'undefined') {
  useStore.subscribe((s, prev) => {
    if (s.view === 'loading' || s.view === 'error') return;
    if (s.server !== prev.server || s.view !== prev.view) rememberServer(s.server);
  });
}

// The tab's title names the build ("HCP: <name>"), so a bookmark or a copied tab carries the name
if (typeof document !== 'undefined') {
  const showTitle = (b: Build | undefined) => {
    const t = tabTitle(b?.name);
    if (document.title !== t) document.title = t;
  };
  showTitle(useStore.getState().build);
  useStore.subscribe((s, prev) => {
    if (s.build !== prev.build) showTitle(s.build);
  });
}

// A share link pasted into a tab that already has the planner open only changes the hash (the
// page does not reload), so load the linked build when the hash changes too
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const m = /#b=([A-Za-z0-9_-]+)/.exec(location.hash);
    const { versions, loadBuild, view, serverAsk, closeServerAsk, load } = useStore.getState();
    if (!m) return;
    if (!versions) {
      // still loading: a question the load asked (the first visit's server list, the return
      // question) would hold the link back until a reload, so the load starts over with it
      if (view === 'loading' && serverAsk && !serverAsk.cancellable) {
        closeServerAsk(null); // the waiting load stops there
        void load();
      }
      return;
    }
    const named = serverFromPath(location.pathname, import.meta.env.BASE_URL);
    // for the server the address names (or, naming none, the one the code's game version belongs to)
    const decoding = named.unknown
      ? Promise.reject(unknownServer(named.unknown))
      : decodeShare(m[1]!).then((d) => withServer(d, shareServer(named, d.dataVersion)));
    void decoding.then(
      async (b) => {
        // the build open now, after the waits above (it may have changed meanwhile)
        const current = useStore.getState().build;
        // the link's name isn't checked yet: shown as the planner would keep it
        const incoming = cleanName(b.name) ? `"${cleanName(b.name)}"` : 'another build';
        // as the Build menu does: a build with work is only replaced once the user agrees (and the
        // link to the build already open replaces nothing)
        if (current && hasWork(current)) {
          if ((await encodeShare(current)) === m[1] && serverOf(current) === serverOf(b)) return;
          const ok = await useStore.getState().askConfirm({
            title: 'Replace the current build?',
            text: `The link opens ${incoming}, replacing ${current.name ? `"${current.name}"` : 'your current build'}. Save it first if you want to keep it.`,
            okLabel: 'Replace',
          });
          if (!ok) {
            // keep the address on the build that stays open (on its own server's address)
            void encodeShare(current).then((code) => history.replaceState(history.state, '', `${addressPath(useStore.getState())}${location.search}#b=${code}`));
            return;
          }
        } else if (!current) {
          const answer = await askOverRemembered('Replace your last build?', `Opening the link's build ${incoming}`, 'Replace');
          if (answer !== 'go') {
            // Cancel stays on New Build, and the declined link leaves the address so a reload
            // doesn't open it, unless the address has moved on to another link since. A question a
            // newer dialog replaced decided nothing: the link stays. Opening the remembered build
            // instead writes that build's code.
            if (answer === 'cancel' && location.hash === `#b=${m[1]}`) history.replaceState(history.state, '', `${addressPath(useStore.getState())}${location.search}`);
            return;
          }
        }
        await loadBuild(b); // loads its game version, checks it first, and says when it can't
      },
      (e: unknown) => {
        // a bad link leaves the current build alone, and says why
        const f = describeImportFailure(e, "The share link couldn't be opened", "Couldn't open the share link");
        void useStore.getState().tell({ title: f.title, text: f.text });
      },
    );
  });
}

/**
 * What a switch changed in another tab of the site means for this one (the storage event).
 *
 * Every switch is saved in localStorage, so each new or reloaded tab starts from the last change
 * made in any tab. Tabs already open follow only Tooltips: Sound and Music stay as each tab has
 * them, so tabs open side by side to compare builds don't all start the music, each at its own
 * place in the track.
 *
 * @param key The localStorage key that changed (null: the site's storage was cleared).
 * @param value Its new value.
 * @return The state to set in this tab, or null for none.
 */
export function fromOtherTab(key: string | null, value: string | null): { tips: TipMode } | null {
  if (key === 'hcp.tooltips') return { tips: TIP_MODES.includes(value as TipMode) ? (value as TipMode) : 'enabled' };
  if (key === null) return { tips: 'enabled' }; // site data cleared: the default
  return null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const change = fromOtherTab(e.key, e.newValue);
    if (change) useStore.setState(change);
  });
}

// Shift held anywhere switches Enabled tooltips to their Advanced view
if (typeof window !== 'undefined') {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Shift' && useStore.getState().shift !== (e.type === 'keydown')) useStore.setState({ shift: e.type === 'keydown' });
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => useStore.getState().shift && useStore.setState({ shift: false }));
}

/** @return Which tooltip a hover shows now: none, the normal one, or the advanced one. */
export function useTipLevel(): 'off' | 'basic' | 'advanced' {
  const tips = useStore((s) => s.tips);
  const shift = useStore((s) => s.shift);
  if (tips === 'disabled') return 'off';
  return tips === 'advanced' || shift ? 'advanced' : 'basic';
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __store: typeof useStore; __autoWizard: () => string };
  w.__store = useStore;
  // Dev helper: walk the wizard to level 50 taking the first legal power and spreading slots.
  w.__autoWizard = () => {
    for (let guard = 0; guard < 400; guard++) {
      const s = useStore.getState();
      if (s.view !== 'level' || !s.level || !s.gd) return s.view;
      const l = s.level;
      if (l.sub === 'slots') {
        const step = stepsOf(s.steps, l)[l.step]!;
        const levels = stepSlotLevels(step);
        for (let k = 0; k < 200; k++) {
          const cur = useStore.getState().level!;
          const rules = new BuildRules(s.gd, previewBuild(s.gd, s.steps, cur));
          if (rules.slotsLeft(levels) <= 0) break;
          const cands = rules.entries().filter((e) => rules.slotBlock(e, step.level, levels) === null);
          const e = cands[k % Math.max(1, cands.length)];
          if (!e) break;
          s.addPendingSlot(e.key);
        }
        useStore.getState().finishLevel();
        continue;
      }
      const pick = currentPick(s.steps, l);
      const rules = new BuildRules(s.gd, l.base);
      let chosen = rules.setOptions(pick).flatMap((o) => o.powers).find((o) => o.state === 'available')?.power.id;
      if (chosen === undefined) {
        for (const c of rules.newSetChoices('pool', pick).filter((c) => !c.block)) {
          chosen = c.set.p.map((pid) => rules.powerOption(pid, pick)).find((o) => o.state === 'available')?.power.id;
          if (chosen !== undefined) break;
        }
      }
      if (chosen === undefined) return `stuck at pick ${pick}`;
      useStore.getState().choosePower(chosen);
      useStore.getState().finishLevel();
    }
    return 'guard';
  };
}

// the message a build whose power sets can't go together opens with, and how long its OK stays locked
export const PAIR_WARNING_TITLE = 'Invalid power sets';
const PAIR_WARNING_WAIT = 5; // seconds
let pairWarnings = 0; // warnings asked for: only the latest one shows
let reopening: Build | undefined; // the build toOverview is showing again on its own data (no warning)
let reopens = 0; // toOverview's reopenings still loading (Back pressed again before the first ends)

/**
 * Open a dialog once no countdown message is up: a newer dialog waits for it to close rather than
 * replacing it, so the countdown is never cut short. With none up it opens at once.
 *
 * @param open Opens the dialog.
 * @return What `open` returns.
 */
function afterCountdown<T>(open: () => Promise<T>): Promise<T> {
  const counting = () => useStore.getState().confirm?.waitUntil !== undefined;
  if (!counting()) return open();
  return new Promise<T>((resolve, reject) => {
    const off = useStore.subscribe(() => {
      if (counting()) return;
      off();
      // once the closing has finished (its resolve and the other listeners)
      queueMicrotask(() => afterCountdown(open).then(resolve, reject));
    });
  });
}

/**
 * Warn about the build just opened when its primary and secondary can't start a build: an older
 * link's, a saved build's or an import's, from before New Build greyed such pairs (buildPairProblem).
 *
 * The message's OK unlocks after a countdown. It waits for any message the opening itself shows (an
 * import's gaps, a link that couldn't open), which is asked for right after the build opens. Leaving
 * New Build for the build already open (toOverview) doesn't repeat it.
 */
export function warnInvalidPair(): void {
  const { gd, build } = useStore.getState();
  let problem: string | null = null;
  try {
    problem = gd && build ? buildPairProblem(gd, build) : null;
  } catch (e) {
    // a warning is never worth failing the build that opens (links in production keep opening)
    console.error("couldn't check the build's power sets", e);
  }
  if (!problem || !build) return;
  const r = reopening;
  if (r && serverOf(r) === serverOf(build) && r.at === build.at && r.primary === build.primary && r.secondary === build.secondary) return;
  const text = `${problem}. The game won't start a character with these two sets, so this build's level 1 powers can't be picked (they're flagged in red). The build is kept as it is. To play it, start a new build with sets that go together.`;
  const seq = ++pairWarnings;
  // already up: React's dev double mount opens the same build twice
  const shown = () => {
    const c = useStore.getState().confirm;
    return c?.title === PAIR_WARNING_TITLE && c.text === text;
  };
  const show = () => {
    const s = useStore.getState();
    // a later open warns for itself
    if (seq !== pairWarnings || shown() || s.build?.at !== build.at || s.build.primary !== build.primary || s.build.secondary !== build.secondary) return;
    void s.tell({ title: PAIR_WARNING_TITLE, text, wait: PAIR_WARNING_WAIT });
  };
  setTimeout(() => {
    if (shown()) return;
    if (!useStore.getState().confirm) return show();
    const off = useStore.subscribe((s) => {
      if (s.confirm) return;
      off();
      show();
    });
  }, 0);
}
