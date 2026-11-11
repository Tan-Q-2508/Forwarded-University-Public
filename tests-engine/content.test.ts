/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { checkShared, looksPrivate } from "../src/engine/moderation";
import { MAX_CROWD_PER_QUESTION, buildPack } from "../src/engine/pack";
import { validateCurse, validatePersonality, validateQuestion } from "../src/engine/validate";

const good = (over: any = {}): any => ({
  id: "q0001", status: "approved", region: "IN", era: "last5", year: 2024, evergreen: false,
  source: { newspaper: "The Daily Sample Gazette", language: "English" }, source_urls: ["https://news.example.org/a-story"],
  verification: { checked_on: "2026-01-01", sources_confirmed: 2 },
  question: "A town hired a full-time employee to do what outside the office?", real_answer: "Chase away monkeys with a slingshot",
  wrong_options: ["Carry the chai from two km away", "Press lift buttons for officers", "Hold umbrellas over parked files", "Salute printouts before reading"].map((text) => ({ text, origin: "curated", status: "approved" })),
  r2_decoy_category: "Kitty Party Gossip", r2_alias_answers: ["monkey chaser"], r2_house_lies: ["A lift to nowhere", "A tax on shadows", "A mango ATM"],
  lore: { comparisons: [{ text: "as many as 1,000 cups of chai", math: "100000/100=1000" }, { text: "as tall as 3 autos", math: "9/3=3" }], card_caption: "A monkey business" },
  topic_tags: ["monkeys"], sensitivity: { flags: [], cleared: true }, ...over,
});
const goodP = (over: any = {}): any => ({
  id: "p001", status: "approved", name: "Imaginary Person", aliases: ["IP"], hints: ["I once lost a race to a tortoise", "My cat has more followers than me", "Chai is my cardio", "I sneeze in four languages", "People call me by my initials"],
  illustration_brief: "A stylised cartoon of a person holding a chai", sensitivity: { cleared: true }, ...over,
});
const rows = (over: any = {}) => ({ questions: [JSON.stringify(good())], personalities: [JSON.stringify(goodP())], names: Array.from({ length: 5 }, (_, i) => `Decoy ${i}`), curses: ["Speak only in questions until {target} laughs"], crowd: [], blocks: [], ...over });

describe("shared-pool moderation (what other groups may ever see)", () => {
  test.each([
    ["A pigeon on a traffic police salary", true],
    ["Ramesh from accounts", true], // 'ram' only blocks as a whole word
    ["Grammar police in the lift", true],
    ["Hindu temple fundraiser", false], ["Caste certificate for a samosa", false], ["Muslim wedding buffet", false],
    ["Terror in the canteen", false], ["Kids' school bus", false], ["Naked mango", false],
    ["Call me on 9876543210", false], ["Visit www.scam.in", false], ["mail me a@b.com", false],
    ["you bhenchod", false], ["F U C K this", false],
  ])("%s", (text, ok) => { expect(checkShared(text as string).ok).toBe(ok); });
  test("reports why it was blocked", () => { expect(checkShared("a mosque joke").reason).toBe("religion"); expect(checkShared("Dalit joke").reason).toBe("caste"); });
  test("crowd fakes never carry player names or the room code", () => {
    expect(looksPrivate("Aarav sings opera", ["Aarav", "Bina"], "KXRT")).toBe(true);
    expect(looksPrivate("the code is kxrt lol", ["Aarav"], "KXRT")).toBe(true);
    expect(looksPrivate("A haunted ceiling fan", ["Aarav", "Bina"], "KXRT")).toBe(false);
    expect(looksPrivate("Aaravind the Great", ["Aarav"], "KXRT")).toBe(false); // whole-name match only
  });
});

describe("question validation (the load-time checks)", () => {
  test("a good approved question passes", () => { expect(validateQuestion(good(), { requireApproved: true })).toEqual([]); });
  test("the EXAMPLE sample can never be imported", () => {
    const sample = JSON.parse(readFileSync("content/samples/example-question.json", "utf8"));
    const p = validateQuestion(sample, { requireApproved: true });
    expect(p.join(" ")).toMatch(/EXAMPLE/);
    expect(p.join(" ")).toMatch(/only "approved"/);
  });
  test.each([
    ["question over 140", { question: "x".repeat(141) }],
    ["real answer over 60", { real_answer: "y".repeat(61) }],
    ["fewer than 4 approved wrong options", { wrong_options: good().wrong_options.slice(0, 3) }],
    ["a pending crowd option does not count as playable", { wrong_options: [...good().wrong_options.slice(0, 3), { text: "Pending one", status: "pending" }] }],
    ["duplicate options", { wrong_options: [...good().wrong_options.slice(0, 3), { text: "carry the chai from two km away!", status: "approved" }] }],
    ["option equal to the answer", { wrong_options: [...good().wrong_options.slice(0, 3), { text: "chase away monkeys with a slingshot", status: "approved" }] }],
    ["abusive option", { wrong_options: [...good().wrong_options.slice(0, 3), { text: "what a chutiya idea", status: "approved" }] }],
    ["fewer than 3 house lies", { r2_house_lies: ["one", "two"] }],
    ["lore comparison over 72", { lore: { comparisons: [{ text: "z".repeat(73), math: "1" }, { text: "ok", math: "1" }], card_caption: "c" } }],
    ["lore needs 2+ comparisons", { lore: { comparisons: [{ text: "one", math: "1" }], card_caption: "c" } }],
    ["no source link", { source_urls: [] }],
    ["javascript: link", { source_urls: ["javascript:alert(1)"] }],
    ["no source confirmed", { verification: { checked_on: "2026-01-01", sources_confirmed: 0 } }],
    ["sensitivity not cleared", { sensitivity: { flags: ["religion"], cleared: false } }],
    ["bad id", { id: "x1" }],
    ["decoy category over 40", { r2_decoy_category: "d".repeat(41) }],
    ["draft status", { status: "draft" }],
  ])("rejects: %s", (_name, over) => { expect(validateQuestion(good(over as any), { requireApproved: true }).length).toBeGreaterThan(0); });
});

describe("personality + curse validation", () => {
  test("a good personality passes; exactly 5 hints of 90 chars or less", () => {
    expect(validatePersonality(goodP(), { requireApproved: true })).toEqual([]);
    expect(validatePersonality(goodP({ hints: ["a", "b", "c", "d"] })).length).toBeGreaterThan(0);
    expect(validatePersonality(goodP({ hints: [..."abcd"].map(() => "ok hint").concat(["h".repeat(91)]) })).length).toBeGreaterThan(0);
  });
  test("a hint may not give the name (or surname) away", () => {
    expect(validatePersonality(goodP({ hints: ["I am Imaginary Person", "b", "c", "d", "e"] })).join()).toMatch(/gives the name away/);
    expect(validatePersonality(goodP({ hints: ["People shout Imaginary at me", "b", "c", "d", "e"] }), {}).length).toBe(0); // first name alone is fine
    expect(validatePersonality(goodP({ hints: ["a Person of interest", "b", "c", "d", "e"] })).join()).toMatch(/gives the name away/); // surname of 5+ letters is checked
    expect(validatePersonality(goodP({ name: "Imaginary Pat", hints: ["a pat on the back", "b", "c", "d", "e"] })).length).toBe(0); // short surname is not
  });
  test("needs an illustration brief (never a photo) and a cleared sensitivity review", () => {
    expect(validatePersonality(goodP({ illustration_brief: "" })).length).toBeGreaterThan(0);
    expect(validatePersonality(goodP({ sensitivity: { cleared: false } })).length).toBeGreaterThan(0);
  });
  test("curses: 70 chars once {target} is filled in, and clean", () => {
    expect(validateCurse("Speak only in questions until {target} laughs")).toEqual([]);
    expect(validateCurse("x".repeat(60) + "{target}").length).toBeGreaterThan(0);
    expect(validateCurse("call {target} a gandu").length).toBeGreaterThan(0);
  });
});

describe("pack builder: bad rows are skipped, never fatal", () => {
  test("builds a pack and reports nothing skipped for good data", () => {
    const { pack, skipped } = buildPack(rows());
    expect(skipped).toEqual([]);
    expect(pack.questions).toHaveLength(1);
    expect(pack.personalities).toHaveLength(1);
    expect(pack.names).toEqual(expect.arrayContaining(["Imaginary Person", "IP"])); // answers + aliases always in the dropdown
  });
  test("invalid JSON and invalid items are skipped with a reason; the rest still load", () => {
    const { pack, skipped } = buildPack(rows({ questions: ["{oops", JSON.stringify(good({ id: "q0002", real_answer: "" })), JSON.stringify(good({ id: "q0003" }))] }));
    expect(pack.questions.map((q) => q.id)).toEqual(["q0003"]);
    expect(skipped).toHaveLength(2);
  });
  test("a reported option is removed; the question stays playable while 4+ options remain", () => {
    const blocked = good().wrong_options[0].text;
    const g = good(); g.wrong_options.push({ text: "Extra fifth fake", status: "approved" });
    const { pack } = buildPack(rows({ questions: [JSON.stringify(g)], blocks: [{ question_id: "q0001", text: blocked.toUpperCase() + "!" }] }));
    expect(pack.questions[0].wrong_options.some((w) => w.text === blocked)).toBe(false);
    expect(pack.questions[0].wrong_options.length).toBe(4);
  });
  test("a question that drops under 4 approved options after a report leaves play (never a broken round)", () => {
    const { pack, skipped } = buildPack(rows({ blocks: [{ question_id: "q0001", text: good().wrong_options[0].text }] }));
    expect(pack.questions).toHaveLength(0);
    expect(skipped[0]).toMatch(/q0001/);
  });
  test("approved crowd fakes join the pool: de-duplicated, never beyond 12 options, at most 10 per question", () => {
    const crowd = Array.from({ length: 20 }, (_, i) => ({ question_id: "q0001", text: `Crowd joke number ${i}` }));
    const { pack } = buildPack(rows({ crowd }));
    const w = pack.questions[0].wrong_options;
    expect(w.length).toBeLessThanOrEqual(12);
    expect(w.filter((x) => x.origin === "crowd").length).toBeLessThanOrEqual(MAX_CROWD_PER_QUESTION);
    expect(new Set(w.map((x) => x.text.toLowerCase())).size).toBe(w.length);
    const dup = buildPack(rows({ crowd: [{ question_id: "q0001", text: good().wrong_options[0].text }] })).pack.questions[0].wrong_options;
    expect(dup.filter((x) => x.text === good().wrong_options[0].text)).toHaveLength(1);
  });
  test("rejected / pending crowd fakes are never in the pack (only approved rows are passed in)", () => {
    const { pack } = buildPack(rows({ crowd: [] }));
    expect(pack.questions[0].wrong_options.every((w) => w.origin !== "crowd")).toBe(true);
  });
  test("TEST / EXAMPLE rows never load unless local dev explicitly allows them", () => {
    const test1 = JSON.stringify(good({ question: "TEST question number 7?" }));
    expect(buildPack(rows({ questions: [test1] })).pack.questions).toHaveLength(0);
    expect(buildPack(rows({ questions: [test1] }), { allowMarkers: true }).pack.questions).toHaveLength(1);
  });
  test("bad curses are dropped", () => {
    expect(buildPack(rows({ curses: ["fine {target}", "you gandu", "y".repeat(80)] })).pack.curses).toEqual(["fine {target}"]);
  });
  test("an empty bank gives an empty pack, which makes Start refuse (content_not_ready)", () => {
    const { pack } = buildPack({ questions: [], personalities: [], names: [], curses: [], crowd: [], blocks: [] });
    expect(pack.questions.length).toBe(0);
  });
});
