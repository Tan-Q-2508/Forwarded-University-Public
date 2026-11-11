// Fixture data for the static design stage. Everything here is FAKE and written to hit
// the maximum allowed lengths (question 140, option 60, fake 60, name 12, hint 90).
// It is never shown to real players and never imported to production content.

export const LIMITS = { question: 140, setup: 160, option: 60, fake: 60, name: 12, hint: 90, lore: 72, curse: 70 } as const;

export interface Player {
  name: string;
  score: number;
  grey?: boolean;
  ready?: boolean;
}

export const PLAYERS: Player[] = [
  { name: "Kabir", score: 185, ready: true },
  { name: "Aarav Sharma", score: 240, ready: true },
  { name: "Meenakshi M.", score: 95, ready: true },
  { name: "Kabir", score: 310, ready: false },
  { name: "Ishita", score: 150, ready: true },
  { name: "Rohan Verma", score: 60, grey: true },
  { name: "Sanjana", score: 205, ready: true },
  { name: "Vikrant Raj", score: 120, ready: false },
];

export const ROOM_CODE = "KXRT";

export const QUESTION =
  "EXAMPLE FIXTURE: a city corporation hired a full-time employee whose only duty, outside the Commissioner's office, was to do what?";

export const OPTIONS: string[] = [
  "Play a recorded siren every time a file was left pending",
  "Chase away monkeys using a slingshot and a loudspeaker",
  "Carry the Commissioner's chai from a shop two km away",
  "Sit in the lift and press the buttons for the officers",
  "Hold an umbrella over parked files whenever it drizzled",
  "Salute every incoming email printout before it was read",
];
export const TRUE_INDEX = 1;

// who tapped what in the reveal: [check owners], [bomb owners]
export const REVEAL: { checks: number[]; bombs: number[] }[] = [
  { checks: [2], bombs: [] },
  { checks: [0, 1, 4, 6], bombs: [2] }, // the truth
  { checks: [3], bombs: [0, 6] },
  { checks: [], bombs: [] },
  { checks: [7], bombs: [3] },
  { checks: [], bombs: [1] },
];

// Round 2: 8 fakes + the real answer = 9 slots (the maximum the grid is built for)
export const R2_CATEGORY = "Kitty Party Gossip";
export const R2_PROMPT = "EXAMPLE FIXTURE: what did the council actually spend its entire annual budget on?";
export const R2_OPTIONS: string[] = [
  "A solar-powered statue of the mayor's pet parrot, 12 ft tall",
  "Free pani puri coupons for every pothole reported in a ward",
  "A 40-lane roundabout that leads only to another roundabout",
  "Hiring 300 pigeons as junior traffic police officers",
  "A lift that goes only sideways, built for the budget meeting",
  "Wi-Fi for the municipal cow shelter, password: moomoo123",
  "Gold-plated manhole covers for the main road, all 87 of them",
  "A giant statue of a fictional cat in the market square",
  "Renaming every street after the mayor's fave cricket scores",
];

// Round 3
export const R3_HINTS: (string | null)[] = [
  "EXAMPLE FIXTURE: I am a made-up person who forgot to be famous, so please guess",
  "EXAMPLE FIXTURE: my name is a pun about samosas, and I am fictional for testing",
  "EXAMPLE FIXTURE: no real person was harmed in the making of this hint, promise",
  null,
  null,
];

export const PODIUM_ORDER = [3, 1, 6, 0, 4, 7, 2, 5]; // indices into PLAYERS by final rank

export const TICKER =
  "BREAKING: MAN SUES DOG FOR EATING HOMEWORK  •  LOCAL PIGEON PROMOTED TO TRAFFIC POLICE  •  FAKE NEWS IS ALSO A LIFESTYLE  •  ";
