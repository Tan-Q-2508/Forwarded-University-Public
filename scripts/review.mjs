// Batch review of crowd fakes and player reports (D1).
//   node scripts/review.mjs list [--remote]
//   node scripts/review.mjs approve-crowd <id...> [--remote]     (max 10 approved per question)
//   node scripts/review.mjs reject-crowd <id...> [--remote]
//   node scripts/review.mjs restore-question <qid> [--remote]    put a pulled question back in play
//   node scripts/review.mjs retire-question <qid> [--remote]
//   node scripts/review.mjs unblock <qid> "<option text>" [--remote]
//   node scripts/review.mjs close-reports <id...|all> [--remote]
// Nothing is ever approved automatically.
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const REMOTE = argv.includes("--remote");
const [cmd, ...rest] = argv.filter((a) => a !== "--remote");
const MAX = 10;

function d1(sql) {
  // one shell string with the SQL in double quotes (SQL here only uses single quotes), so it is not split on spaces
  const r = spawnSync(`npx wrangler d1 execute DB ${(REMOTE ? "--remote" : "--local")} --json --command "${sql.replace(/"/g, "\\\"")}"`, { encoding: "utf8", shell: true });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
  const out = r.stdout.slice(r.stdout.indexOf("["));
  return JSON.parse(out)[0].results ?? [];
}
const nums = (xs) => xs.map((x) => { if (!/^\d+$/.test(x)) { console.error(`not an id: ${x}`); process.exit(1); } return Number(x); });
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

switch (cmd) {
  case "list": {
    const crowd = d1("SELECT id, question_id, text, seen FROM crowd_fakes WHERE status = 'pending' ORDER BY question_id, seen DESC LIMIT 200");
    const reports = d1("SELECT * FROM reports WHERE status = 'open' ORDER BY id");
    const pulled = d1("SELECT id, status FROM questions WHERE status = 'reported'");
    console.log(`\nPENDING CROWD FAKES (${crowd.length}) — approve/reject by id`);
    for (const c of crowd) console.log(`  #${c.id}  ${c.question_id}  x${c.seen}  ${c.text}`);
    console.log(`\nOPEN REPORTS (${reports.length})`);
    for (const r of reports) console.log(`  #${r.id}  ${r.question_id}  ${r.reason ?? "?"}/${r.kind}${r.option_text ? `  "${r.option_text}"` : ""}${r.note ? `  NOTE: ${r.note}` : ""}  (${r.phase}, ${r.created_at})`);
    console.log(`\nQUESTIONS PULLED BY A REPORT (${pulled.length}): ${pulled.map((p) => p.id).join(", ") || "none"}\n`);
    break;
  }
  case "approve-crowd": {
    for (const id of nums(rest)) {
      const row = d1(`SELECT question_id FROM crowd_fakes WHERE id = ${id} AND status = 'pending'`)[0];
      if (!row) { console.log(`#${id}: not pending`); continue; }
      const n = d1(`SELECT COUNT(*) AS n FROM crowd_fakes WHERE question_id = ${q(row.question_id)} AND status = 'approved'`)[0].n;
      if (n >= MAX) { console.log(`#${id}: ${row.question_id} already has ${MAX} approved crowd fakes`); continue; }
      d1(`UPDATE crowd_fakes SET status = 'approved' WHERE id = ${id}`);
      console.log(`#${id}: approved`);
    }
    break;
  }
  case "reject-crowd": for (const id of nums(rest)) { d1(`UPDATE crowd_fakes SET status = 'rejected' WHERE id = ${id}`); console.log(`#${id}: rejected (never shown again)`); } break;
  case "restore-question": d1(`UPDATE questions SET status = 'approved' WHERE id = ${q(rest[0])} AND status = 'reported'`); console.log(`${rest[0]}: back in play`); break;
  case "retire-question": d1(`UPDATE questions SET status = 'retired' WHERE id = ${q(rest[0])}`); console.log(`${rest[0]}: retired`); break;
  case "unblock": d1(`DELETE FROM option_blocks WHERE question_id = ${q(rest[0])} AND text = ${q(rest[1])}`); console.log("unblocked"); break;
  case "close-reports": d1(rest[0] === "all" ? "UPDATE reports SET status = 'closed' WHERE status = 'open'" : `UPDATE reports SET status = 'closed' WHERE id IN (${nums(rest).join(",")})`); console.log("closed"); break;
  default: console.log(readFileHead());
}
function readFileHead() { return "Usage: node scripts/review.mjs list | approve-crowd <id...> | reject-crowd <id...> | restore-question <qid> | retire-question <qid> | unblock <qid> \"<text>\" | close-reports <id...|all>   [--remote]"; }
