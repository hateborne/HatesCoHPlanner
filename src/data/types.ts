/**
 * Shapes of the JSON written by pipeline/export.py (public/data/<version>/*.json).
 * Short keys keep the payload small; absent optional keys mean the game default.
 */

/** One AttribMod: an attribute change applied by an effect. */
export interface Mod {
  a: number[]; // attribute byte offsets (see Core.attribs)
  asp: string; // Current | Maximum | Strength | Resistance | Absolute
  t: string; // Magnitude | Duration | Constant | Expression | SkillMagnitude
  tg: string; // Caster | Affected | Focus | ...
  tbl: string; // class mod table name
  sc: number; // scale
  app?: string; // application type when not OnTick
  dur?: number;
  mag?: number;
  del?: number;
  per?: number;
  tc?: number; // tick chance
  stk?: string; // stack type when not Stack
  stkL?: number;
  stkK?: number;
  dx?: string[]; // duration expression
  mx?: string[]; // magnitude expression
  dreq?: string[];
  sup?: unknown;
  fl?: string[]; // flag names (IgnoreStrength, Boost, BoostIgnoreDiminishing, ...)
  bma?: number;
  pw?: number[]; // power ids for grant/revoke/execute mods
  pwn?: string[]; // a pseudo-pet's power's grants, by full name (the pets file allocates no ids)
}

/** An effect group: chance, requirements and its mods. */
export interface Effect {
  ch?: number;
  ppm?: number;
  del?: number;
  req?: string[];
  tag?: string[];
  fl?: string[]; // PVEOnly | PVPOnly | ...
  ef?: number;
  m?: Mod[];
  sub?: Effect[];
}

/** A power (also used for enhancements, type "Boost", and set-bonus powers). */
export interface Power {
  id: number;
  n: string; // full name Category.Set.Power
  dn: string;
  sh: string;
  lh: string;
  icon: string;
  type: string; // Click | Auto | Toggle | Boost | Inspiration | GlobalBoost
  tgt: string;
  ea?: string[]; // entities affected when different from tgt (Caster, Teammate, Foe, ...)
  auto?: number;
  free?: number;
  na?: number;
  acc?: number; // default 1
  rech?: number;
  end?: number;
  rng?: number;
  rng2?: number;
  cast?: number;
  ap?: number;
  rad?: number;
  arc?: number;
  maxT?: number;
  intr?: number;
  ign?: number;
  proc?: number;
  flb?: number;
  maxB?: number;
  sm?: number; // 0 = hidden from Manage
  si?: number;
  ilb?: number;
  area?: string;
  br?: string[];
  actr?: string[];
  slr?: string[];
  ba?: number[]; // BoostsAllowed: <5 origin index, >=5 boost type (attribNames.Boost[v-5])
  gm?: string[];
  atk?: number[];
  rg?: string[];
  modr?: number[];
  modd?: number[];
  slot?: [number, number]; // min/max character level (0-based) this enhancement may be slotted
  maxBL?: number;
  redir?: { p: number; req: string[] }[];
  eff?: Effect[];
  act?: Effect[];
  // enhancement-only
  bf?: [string, string];
  pog?: string;
  bb?: number; // boostable (accepts boosters)
  bup?: number; // uses player level (attuned)
  bie?: number; // ignores level effectiveness (IOs)
  bac?: number;
  bll?: number;
  bhl?: number;
  bcc?: number; // catalyst conversion target id
  bcm?: number; // BoostCombinable (TO/DO/SO style); IOs and set pieces can't be combined
  ntr?: number; // not tradeable
  bab?: number; // account bound
  cat?: string; // the enhancement's category line (its Boosts.* set's short help: "Invention", ...)
}

export interface Powerset {
  id: number;
  n: string;
  dn: string;
  sh: string;
  lh: string;
  icon: string;
  p: number[]; // power ids in display order
  av: number[]; // 0-based level available per power; -1 = granted with the set
  sbr?: string[];
  sbrt?: string; // the game's message when SetBuyRequires fails
  sr?: string[];
  spr?: string[];
  spa?: number; // SpecializeAt (0-based)
  sm?: number;
}

export interface Archetype {
  id: number;
  n: string; // Class_Blaster
  dn: string;
  sh: string;
  lh: string;
  icon: string;
  cats: { pri: string; sec: string; pool: string; epic: string; inherent: string };
  base: Record<string, number | number[]>;
  min: Record<string, number | number[]>;
  strMin: Record<string, number | number[]>;
  resMin: Record<string, number | number[]>;
  max: Record<string, number | number[]>;
  maxMax: Record<string, number | number[]>;
  strMax: Record<string, number | number[]>;
  resMax: Record<string, number | number[]>;
  mod: Record<string, number>; // lower-cased table name -> index into Core.modTables
}

export interface Origin {
  id: number;
  n: string;
  dn: string;
  sh: string;
  lh: string;
  icon: string;
}

export interface NamedEntry {
  n: string;
  dn: string;
  icon: string;
}

export interface DimReturnSet {
  default: number;
  boost: number[];
  sets: { default: number; a: number[]; ret: { start: number; h: number }[] }[];
}

export interface Core {
  archetypes: Archetype[];
  modTables: number[][];
  origins: Origin[];
  attribs: Record<string, { name: string; aliases: string[]; kind: string }>;
  attribNames: {
    Damage: NamedEntry[];
    Defense: NamedEntry[];
    Boost: NamedEntry[];
    Elusivity: NamedEntry[];
    Group: NamedEntry[];
    Mode?: NamedEntry[]; // power modes: SetMode's magnitude indexes this list
  };
  categories: Record<string, number[]>;
  schedule: { power: number[]; slot: number[]; pool: number[]; epic: number[]; freeSlots: number[] };
  dimReturns: DimReturnSet[];
  boostEffect: { above: number[]; below: number[]; boosters: number[] };
  exemplar: { Limits: number[]; Weights: number[]; PreClamp: number[]; PostClamp: number[] };
  manifest: {
    dataVersion: string; // the game version id (its folder under public/data/)
    hash?: string; // content hash of this version's data files
    generated: string;
    counts: Record<string, number>;
    // an approximate version (pipeline/overlay.py): its base version, the patch it stands for and
    // the Mids database its power levels came from
    approximate?: { base: string; patch: string; midsDb: string; from: string };
    framesFrom?: string; // the version whose enhancement frames it borrowed (its client had none)
  };
}

/**
 * A pseudo-pet one EntCreate mod creates, as the client's power info totals its damage
 * (getTotalDamage's pet branch; see Exporter.build_pets). Only pets whose every power is Auto are
 * listed, as only those count.
 */
export interface PetCreation {
  p: string[]; // the pet's powers (keys of PetsFile.powers), in the order the client lists them
  def?: number; // how many of them (the first) come from its villain def; the rest are the mod's own
  dur?: number; // the mod's Duration: each pet power counts max(1, floor(dur / its ap) + PetsFile.plus) times
  boosts?: number; // 1: CopyBoosts, the pet's damage takes the caster's enhancements
  pseudo?: number; // 1: PseudoPet, the pet runs with its caster's class
  cls?: string; // otherwise the class it runs with (the mod's Class, else its villain def's)
  hid?: number; // 1: the client lists none of its effects (Homecoming's, for a mod under a HideFromInfo group); its damage counts
}

/** A pet's power: what its damage total needs. */
export interface PetPower {
  type: string; // Click | Auto | Toggle | ...
  ap?: number; // ActivatePeriod
  eff?: Effect[];
  act?: Effect[];
}

/**
 * One game version's pseudo-pets (<server data>/pets/<version>.json), kept beside the version's
 * folder so a published folder never changes. Optional: without it powers show no pet damage.
 */
export interface PetsFile {
  plus?: number; // the server's client counts each pet power max(1, floor(dur / ap) + plus) times (Thunderspy's 1)
  pets: Record<string, PetCreation[]>; // creating power (full name) -> the pets its EntCreate mods make
  powers: Record<string, PetPower>; // pet powers by full name, and the powers they execute
  names?: Record<string, string>; // display names of what pet powers grant that the version's own data lacks
  // per power, the executions its PvP-only groups hold (the export drops those groups; the client's
  // damage total counts every execution): what each runs, and 1 when it copies boosts
  exec?: Record<string, { p: string[]; boosts?: number }[]>;
  classes: Record<string, Record<string, number>>; // class -> lower-cased table name -> index into tables
  tables: number[][];
}

export interface BoostSetBonus {
  min: number;
  max: number;
  auto: number[];
  req?: string[];
  bp?: number;
  txt?: string;
}

export interface BoostSet {
  id: number;
  n: string;
  dn: string;
  grp: string;
  conv: string[];
  minL: number;
  maxL: number;
  slots: number[][]; // per piece letter: [crafted, attuned, ...] boost power ids
  elig: number[]; // power ids that accept this set
  bon: BoostSetBonus[];
}

export interface BoostsFile {
  boosts: Power[];
  bonusPowers: Power[];
  sets: BoostSet[];
}
