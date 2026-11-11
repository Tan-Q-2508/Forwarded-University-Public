import {
  OPTIONS, PLAYERS, QUESTION, R2_CATEGORY, R2_OPTIONS, R2_PROMPT, R3_HINTS,
  REVEAL, ROOM_CODE, TRUE_INDEX,
} from "./fixtures";
import { LIMITS, avatar, cut, esc, shell, withModal, type Orientation, type Screen } from "./ui";
import { newReport, reportModalHtml, rulesModalHtml, RULEBOOK } from "./report";
import { fixtureHomeScreen, fixtureLobby, fixtureWait } from "./live";
import { fixtureIxPick, fixtureIxResult } from "./ix";
import { fixturePodium, fixturePostgame } from "./end";
import { fixtureR3Hint, fixtureR3Reveal, fixtureR3Wager } from "./r3";
import { fixtureR2Guess, fixtureR2Pick, fixtureR2Reveal, fixtureR2Vote, fixtureR2Write } from "./r2";
import { fixtureLore, fixtureR1Question, fixtureR1Reveal, fixtureRules } from "./r1";
export type { Orientation, Screen };

const LETTERS = "ABCDEFGHI";
const fxView = (kind: string, options: string[]) => ({ you: { seated: true }, phase: { kind }, data: { options } });
/** Screens that show the report flag in their header (same rule as reportable() in the live app). */
export const REPORT_IDS = new Set(["r1-question", "r1-reveal", "r2-guess", "r2-write", "r2-reveal", "r2-vote", "r3-hint", "r3-reveal", "lore", "report-modal", "report-modal-empty", "report-modal-lore"]);

export const SCREENS: Screen[] = [
  { id: "home", label: "0 Home", render: fixtureHomeScreen },
  { id: "lobby", label: "1 Lobby", render: fixtureLobby },
  { id: "r1-question", label: "2 R1 Question", render: fixtureR1Question },
  { id: "r1-reveal", label: "3 R1 Reveal", render: fixtureR1Reveal },
  { id: "r2-guess", label: "4 R2 Guess", render: fixtureR2Guess },
  { id: "report-modal", label: "M1 Report form (9 options)", render: (o) => withModal(fixtureR2Guess(o), reportModalHtml(o, fxView("r2guess", R2_OPTIONS), { kind: "report", reason: "offensive", target: 3, note: "X".repeat(140) })) },
  { id: "report-modal-empty", label: "M2 Report form (empty)", render: (o) => withModal(fixtureR1Question(o), reportModalHtml(o, fxView("r1q", OPTIONS), newReport())) },
  { id: "report-modal-lore", label: "M3 Report form (lore)", render: (o) => withModal(fixtureLore(o), reportModalHtml(o, fxView("r1lore", []), newReport("wrong"))) },
  ...RULEBOOK.map((t, i): Screen => ({ id: `rules-modal-${i}`, label: `M4 Rulebook ${t.tab}`, render: (o) => withModal(fixtureHomeScreen(o), rulesModalHtml(o, { kind: "rules", tab: i })) })),
  { id: "r2-pick", label: "R2a Tile pick", render: fixtureR2Pick },
  { id: "r2-write", label: "R2b Write", render: fixtureR2Write },
  { id: "r2-reveal", label: "R2c Reveal", render: fixtureR2Reveal },
  { id: "r2-vote", label: "R2d Vote", render: fixtureR2Vote },
  { id: "r3-hint", label: "5 R3 Hints", render: fixtureR3Hint },
  { id: "podium", label: "6 Podium", render: fixturePodium },
  { id: "ix-pick", label: "I1 Interlude pick", render: fixtureIxPick },
  { id: "ix-result", label: "I2 Interlude result", render: fixtureIxResult },
  { id: "rules", label: "R Rules card", render: fixtureRules },
  { id: "lore", label: "L Lore card", render: fixtureLore },
  { id: "r3-wager", label: "R3a Wager", render: fixtureR3Wager },
  { id: "r3-reveal", label: "R3c Reveal", render: fixtureR3Reveal },
  { id: "postgame", label: "P Play again", render: fixturePostgame },
  { id: "wait", label: "7 Phase (placeholder)", render: fixtureWait },
];
