// DEV ONLY. Synthetic content so the engine and the local demo can run a whole game before the real
// content bank exists. Every string says TEST. It is NEVER imported by production paths: the Worker only
// loads it when the DEV_CONTENT variable is "1" (local wrangler dev).
import type { ContentPack, QuestionLite } from "./types";

export function makeContent(nQ = 40, nP = 12): ContentPack {
  const questions: QuestionLite[] = Array.from({ length: nQ }, (_, i) => ({
    id: `q${String(i + 1).padStart(4, "0")}`,
    region: i % 3 === 0 ? "WORLD" : "IN",
    topic_tags: [`tag${i}`],
    question: `TEST question number ${i}?`,
    real_answer: `Real answer ${i} zebra`,
    wrong_options: Array.from({ length: 6 }, (_, k) => ({ text: `Wrong ${i}-${k} banana`, origin: "curated", status: "approved" })),
    r2_decoy_category: `Decoy ${i}`,
    r2_alias_answers: [`alias ${i} zebra`],
    r2_house_lies: [`House lie ${i}-a`, `House lie ${i}-b`, `House lie ${i}-c`, `House lie ${i}-d`],
    lore: { comparisons: [{ text: "TEST", math: "1+1" }, { text: "TEST", math: "2+2" }], card_caption: "TEST" },
    source: { newspaper: "TEST" }, source_urls: ["https://example.com/test"],
  }));
  const personalities = Array.from({ length: nP }, (_, i) => ({
    id: `p${String(i + 1).padStart(3, "0")}`, name: `Person ${i} Test`, aliases: [`Pers${i}`],
    hints: [1, 2, 3, 4, 5].map((h) => `hint ${h} for ${i}`),
  }));
  const names = [...personalities.map((p) => p.name), ...Array.from({ length: 300 }, (_, i) => `Decoy Name ${i}`)];
  return { questions, personalities, names, curses: ["Speak only in questions until {target} laughs"] };
}

