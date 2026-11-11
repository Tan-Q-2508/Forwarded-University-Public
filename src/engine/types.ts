// Pure engine types. No Cloudflare imports, no clock, no randomness except the seeded rng stored in state.

export type PhaseKind =
  | "lobby" | "rules" | "r1q" | "r1reveal" | "r1lore"
  | "ixPick" | "ixResult"
  | "r2pick" | "r2write" | "r2guess" | "r2reveal" | "r2vote" | "r2end"
  | "r3wager" | "r3hint" | "r3reveal"
  | "podium" | "postgame";

export interface Player {
  name: string;
  key: string; // lowercase name, the identity inside a room
  token: string | null; // device token: same device may take over a live seat
  joinIdx: number;
  joinedAt: number;
  score: number;
  connected: boolean;
  seated: boolean; // false = spectator
  lastSeq: number;
  r1Correct: number;
  r3Points: number; // net points from R3 wagers (tiebreaks)
  greySince: number | null;
}

export interface Phase {
  kind: PhaseKind;
  id: number;
  dur: number; // full duration in ms (0 = untimed)
  deadline: number | null; // server timestamp; null if untimed or frozen
  graceAt: number | null; // hot-seat disconnect grace
  done: string[]; // names that locked / are ready in this phase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d: any; // phase-specific data (secrets live here, never sent raw to clients)
}

export interface QuestionLite {
  id: string;
  region: "IN" | "WORLD";
  topic_tags: string[];
  question: string;
  setup?: string;
  real_answer: string;
  wrong_options: { text: string; origin?: string; status?: string }[];
  r2_decoy_category: string;
  r2_alias_answers?: string[];
  r2_house_lies: string[];
  lore: { comparisons: { text: string; math: string }[]; card_caption: string };
  source: { newspaper: string; language?: string; state_or_city?: string };
  source_urls: string[];
}

export interface PersonalityLite {
  id: string;
  name: string;
  aliases?: string[];
  hints: string[]; // exactly 5
}

export interface ContentPack {
  questions: QuestionLite[];
  personalities: PersonalityLite[];
  names: string[]; // searchable dropdown (answers + decoys)
  curses: string[]; // clean verbal curses; may contain "{target}"
}

export interface Ctx { content: ContentPack }

export interface Curse {
  name: string; // cursed player
  text: string;
  target: string | null;
  active: boolean;
  window: { first: string; until: number; voters: string[] } | null;
  cooldown: Record<string, number>;
}

export interface State {
  v: 1;
  code: string;
  rng: number;
  now: number;
  players: Player[];
  owner: string | null;
  curses: boolean; // lobby toggle: verbal curses
  phase: Phase;
  phaseCounter: number;
  seq: number;
  frozen: boolean;
  emptySince: number | null;
  closed: boolean;
  alarmAt: number | null; // last alarm we asked the host to set
  usedQ: string[]; // per-room, survives Play Again
  usedP: string[];
  gameNo: number;
  game: {
    gameUsedQ: string[];
    qs: Record<string, QuestionLite>;
    r1: { ids: string[]; qi: number };
    r2: { order: string[]; turn: number; tiles: { decoy: string; qid: string | null; garbage: boolean; taken: boolean }[]; garbageUsed: boolean };
    r3: { ids: string[]; idx: number; ps: Record<string, PersonalityLite>; cur: any };
    ix: { underdog: string | null; dealer: string | null; vip: string | null };
    curse: Curse | null;
  };
  dirtySave: boolean;
}

export type Event =
  | { type: "join"; at: number; name: string; token?: string; conn?: string }
  | { type: "disconnect"; at: number; name: string }
  | { type: "intent"; at: number; name: string; phaseId: number; seq: number; intent: Intent }
  | { type: "alarm"; at: number };

export type Intent =
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "curses"; on: boolean }
  | { type: "skip" }
  | { type: "next" }
  | { type: "r1.select"; check: number | null; bomb: number | null }
  | { type: "r1.lock" }
  | { type: "r1.unlock" }
  | { type: "ix.pick"; box: number }
  | { type: "snitch" }
  | { type: "r2.tile"; tile: number }
  | { type: "r2.write"; text: string }
  | { type: "r2.preset" }
  | { type: "r2.pick"; option: number }
  | { type: "r2.vote"; option: number }
  | { type: "r3.slider"; pct: number }
  | { type: "r3.lock"; pct: number }
  | { type: "r3.guess"; name: string }
  | { type: "r3.pass" }
  | { type: "r3.unpass" }
  | { type: "again" }
  | { type: "leave" };

export type Effect =
  | { t: "broadcast" } // state changed: host recomputes viewFor() per socket
  | { t: "send"; to: string; msg: Record<string, unknown> } // private message to one player
  | { t: "reply"; conn?: string; msg: Record<string, unknown> } // answer to a join attempt
  | { t: "alarm"; at: number | null }
  | { t: "save" } // persist snapshot (phase changes + lock-ins only)
  | { t: "wipe" } // delete room storage
  | { t: "crowdFake"; questionId: string; text: string };
