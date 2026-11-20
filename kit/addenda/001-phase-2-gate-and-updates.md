# 001 · Phase 2 composition gate and thread updates

Added November 20, 2026. This beats `kit/07-QUALITY-BAR.md` and `kit/08-BUILD-ORDER.md` on the two topics below.

## Why

- C8 blockout has scored 5, 6, 6, 5, 8, 7, 7 against `quality.passScore`. Each round the earlier issues clear and a fresh reviewer faults different shots.
- Composition cannot be settled on gray boxes. It is settled with light, material and atmosphere, which arrive in Phase 3.
- The largest unknown in this build is how close the finished look gets to the blind jury. Nothing tests that until Phase 3.

## The Phase 2 gate

This replaces the gate line "C5 blockout and C8 blockout each score at least `quality.passScore` with no severe or major issue open".

- C5 blockout scores at least `quality.passScore` with no severe or major issue open.
- C8 blockout scores at least `quality.blockoutCompositionPass` with no severe issue open.

Round 7 already meets both. So:

1. Run no more blockout critic rounds.
2. Choose between the round 7 cameras and the round 8 draft, whichever you judge stronger. Log the choice.
3. Write every C8 blockout issue still open from rounds 6 and 7 into `cut/SHOTS.md` under a heading "Carried into Phase 3".
4. Do the rest of Phase 2 as written: the preview film, `npm run proof`, `npm run proof -- --memory`, `npm run keep`, the gate for G1 to G9, commit and push.
5. Start Phase 3.

What does not change:

- C8 in Phases 3 and 4 still needs `quality.passScore` with no severe or major issue open. The carried issues are judged there, with lighting.
- Every other gate, critic and threshold.

From here, detail work on the vehicle, the wheel and the deck belongs to Phase 3 and is done against the hero frame and the macro frame first.

## Updates in the thread

Brandon wants to see the build as it goes.

- After every critic round, at every phase gate, and when a phase starts, post an update in the task thread.
- Each update has: the phase and round, every score, the top issue, what changes next, and images.
- Images in Phase 2: the contact sheets. From Phase 3: the hero frame and the macro frame, plus the two judged frames that changed most since the last update.
- Post and keep working. Never wait for a reply. An update is not a question.
- If the thread cannot show images, say so once and post the text.
