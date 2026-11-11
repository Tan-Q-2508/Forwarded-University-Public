// Room codes: 4 letters, no I, O or L, no blocked words.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const BLOCKED = new Set(["SHIT", "FUCK", "CUNT", "DICK", "COCK", "TITS", "PISS", "CRAP", "RAPE", "ANAL", "SEXY", "NAZI", "KKK", "GAND", "CHUT", "RAND", "BSDK", "MKC", "BKL"]);

export function randomCode(): string {
  for (;;) {
    const b = crypto.getRandomValues(new Uint8Array(4));
    const code = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
    if (!BLOCKED.has(code)) return code;
  }
}
export const isValidCode = (c: string) => /^[A-HJ-KM-NP-Z]{4}$/.test(c);
