import { MAX_PET_SWITCHES } from '../engine/build.ts';

/**
 * The limits every import keeps to, in one table.
 *
 * Everything imported comes from strangers, and no input may make the tab do unbounded work
 * (AGENTS.md): text is refused past these before anything is built from it. A real build holds 24
 * picks, 6 slots on a power and a few dozen granted powers, and its files are a few KB to a few
 * hundred KB of text, so each limit sits far above any real build and a count past one means
 * damaged or crafted input.
 *
 * Each format keeps the numbers its reader has always had (a link allows 32 slots on a power, a
 * file 64); tests/importlimits.test.ts pins every one. A share link's limits are part of what old
 * links are read with, so they are never lowered (AGENTS.md, "links never break").
 */
export const IMPORT_LIMITS = {
  // text as it comes in, pasted or read from a file (its length, and a file's size in bytes); also
  // what a Mids code's JSON may hold once unpacked
  text: 2_000_000,
  // what a share link's or a Mids code's data may inflate to, in bytes: a real one is a few KB
  inflated: 1 << 20,
  // a share link (#b=...)
  link: {
    payload: 64 * 1024, // characters of code: a full level-50 build's is under 1,000
    picks: 64,
    slots: 32, // on one power
    granted: 512,
    petSwitches: MAX_PET_SWITCHES, // as many as a checked build keeps
    petName: 160, // bytes: a pet power's full name is under 80
  },
  // a Mids build, as a share code's data or an .mbd file (8 power sets, ~40 power entries)
  mids: {
    sets: 32,
    powers: 512,
    slots: 64, // on one power
  },
  // a /build_save file (about 60 power lines with the inherents)
  buildTxt: {
    powers: 512,
    slots: 64, // on one power
    skipped: 200, // lines the reader can't place: a real file has none
  },
} as const;
