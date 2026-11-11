// Moderation. Two levels:
//  - in-room (text.ts isBlocked): abuse/slurs only, applies to every typed fake in the room.
//  - SHARED POOL (this file): what may be saved for OTHER groups. Much stricter: abuse + sensitive topics
//    (religion, caste, communities, tragedies, minors, sexual content) + anything that looks like personal data.
// Pure, so it can be unit tested and used by the import script.
import { isBlocked } from "./text.ts";

// Whole-word matches on the lower-cased text. Deliberately over-cautious: a funny fake that is blocked here only
// stays private to its own room; a sensitive one that slips through would reach every group.
const SENSITIVE: Record<string, string[]> = {
  religion: ["hindu", "hinduism", "muslim", "islam", "islamic", "christian", "christianity", "sikh", "sikhism", "jain", "buddhist", "jew", "jewish", "allah", "god", "gods", "bhagwan", "jesus", "ram", "krishna", "shiva", "ganesh", "quran", "bible", "gita", "temple", "mandir", "mosque", "masjid", "church", "gurdwara", "pandit", "maulvi", "priest", "pope", "religion", "religious", "hijab", "burqa", "namaz", "puja", "azaan"],
  caste: ["dalit", "brahmin", "brahman", "bania", "kshatriya", "shudra", "chamar", "jaat", "caste", "casteist", "obc", "adivasi", "tribal", "untouchable"],
  community: ["pakistani", "pakistan", "chinese", "bangladeshi", "rohingya", "refugee", "immigrant", "foreigner", "northie", "madrasi", "bihari", "gora", "kala", "negro", "gypsy", "eunuch", "hijra", "gay", "lesbian", "transgender", "tranny", "lgbt", "disabled", "handicapped", "cripple", "midget"],
  tragedy: ["terror", "terrorist", "terrorism", "blast", "massacre", "genocide", "riot", "riots", "lynching", "suicide", "murder", "murdered", "killed", "killing", "dead", "death", "died", "corpse", "funeral", "cancer", "covid", "pandemic", "earthquake", "flood", "tsunami", "accident", "crash", "hostage", "kidnap", "kidnapped", "war", "army", "martyr", "shaheed", "pulwama", "26/11", "holocaust"],
  minors: ["child", "children", "kid", "kids", "minor", "minors", "underage", "schoolgirl", "schoolboy", "teen", "teenager", "toddler", "baby", "infant", "orphan"],
  sexual: ["sex", "sexy", "sexual", "porn", "nude", "naked", "boobs", "breast", "penis", "vagina", "dick", "cock", "pussy", "rape", "rapist", "molest", "molested", "harass", "harassment", "condom", "affair", "escort", "stripper", "horny", "orgasm", "nsfw"],
};
const WORD = /[\p{L}\p{N}/]+/gu;
const LISTS = Object.entries(SENSITIVE).map(([topic, words]) => [topic, new Set(words)] as const);

export interface Verdict { ok: boolean; reason?: string }

/** May this text be saved for other groups? */
export function checkShared(text: string): Verdict {
  const t = text.toLowerCase();
  if (isBlocked(text)) return { ok: false, reason: "abuse" };
  const words = t.match(WORD) ?? [];
  for (const w of words) for (const [topic, set] of LISTS) if (set.has(w)) return { ok: false, reason: topic };
  if (/\d{6,}/.test(t.replace(/[\s-]/g, ""))) return { ok: false, reason: "personal_data" }; // phone / id numbers
  if (/@|https?:|www\./.test(t)) return { ok: false, reason: "personal_data" };
  return { ok: true };
}

/** Crowd fakes carry no names and no room codes: reject anything that mentions a player or the room code. */
export function looksPrivate(text: string, playerNames: string[], roomCode: string): boolean {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  if (t.includes(` ${roomCode.toLowerCase()} `)) return true;
  return playerNames.some((n) => {
    const k = n.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return k.length >= 2 && t.includes(` ${k} `);
  });
}
