# 05 — Design and layout rules

## Look and feel
College-fest poster meets breaking-news channel: loud colour, big type, ticker bars, stickers, stamped "BREAKING" tags, confetti, bomb animations, chai-cup comparisons. Not plain boxes. Sound effects with a visible mute button. Use the `frontend-design` skill; use Claude Design if available. Build the design system (colours, type, spacing, components, motion) and 6 key screens first, get the owner's approval, then build the rest.

## Fixed stages
- Landscape stage: **1920×1080**. Portrait stage: **1080×1920**.
- The app picks the stage by aspect ratio and scales the whole stage uniformly to fit (letterbox if needed). All layout is inside the stage in fixed units.
- Every container has a fixed width and height. Content never changes a container's size. Text that is too long is blocked at input time (limits below), not shrunk by the layout.

## Text limits
Question 140 · setup 160 · option 60 · fake 60 · name 12 · hint 90 · lore comparison text 72 (math 40). Minimum rendered text 44 stage units on the stage (readable on phones). Validate on client and server.

## No scrolling, no overflow
Nothing scrolls. R2 option grid fits at 9 slots max. Lore cards use fixed text slots. The typing screen is the one special case: use `visualViewport` so the keyboard does not hide the input; the layout shifts up as a whole without scrolling.

## Test sizes (all must pass)
1920×1080, 1366×768, 2560×1440, iPad landscape 1180×820, iPad portrait 820×1180, phones 390×844, 360×800, 412×915, 430×932.

## Automated check (build must fail on violation)
Playwright opens every screen state (fixture data with the longest allowed strings) at every size, takes screenshots into `test-results/`, and asserts that every element's bounding box lies inside its container and the stage, and that `document.scrollingElement.scrollHeight <= innerHeight`.

## Accessibility
Colour is never the only signal (icons + labels on right/wrong). Contrast ≥ 4.5:1. Honour `prefers-reduced-motion`.
