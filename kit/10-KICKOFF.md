# 10 · Kickoff

For Brandon. The Builder does not act on this file.

## Before the run

1. Write `kit/02-VEHICLE.md`. Replace the `Status: NOT WRITTEN` line with your own content. The build stops at the start if that line is still there.
2. In Computer, open Plugins in the sidebar, find GitHub, select Connect, then Authorize. The Builder needs this to push.
3. Start a new Computer task on your highest effort setting with Multiagent on.
4. Paste the kickoff prompt.

## Kickoff prompt

```
BUILD MODE.

Repo: https://github.com/BrandonChurch93/cyberpunk-car-perplexity

Clone the repo. Read AGENTS.md, then kit/00-README.md, then the kit in its reading order. Build the whole showcase from the kit: work every phase in kit/08-BUILD-ORDER.md in order, pass every gate, run the critic rounds in kit/07-QUALITY-BAR.md until the pass bar holds, log everything in kit/PROGRESS.md, and commit and push after every phase.

Run this as one continuous task. Do not ask me questions and do not stop for approval. Decide, log the decision in kit/PROGRESS.md, and continue. Stop only at BUILD COMPLETE or at a blocker as AGENTS.md defines one.

Use supporting agents wherever the kit calls for them. Do not lower the bar to finish sooner.
```

## Resume prompt

Use this if the task ends before BUILD COMPLETE.

```
BUILD MODE. Clone https://github.com/BrandonChurch93/cyberpunk-car-perplexity and continue from kit/PROGRESS.md. Same rules: no questions, stop only at BUILD COMPLETE or a blocker as AGENTS.md defines one.
```

## After BUILD COMPLETE

1. Open the Export link from the final message in Chrome on a computer with a real GPU.
2. Pick 16x9 and start. Keep the tab open and visible until the file downloads.
3. Do the same for 9x16.
4. Add sound in your editor, using `cut/CUES.md` for timing.
5. Keep the final upload within the limits in `platform` in the config.

## Review

- Bring stills, the preview film or your export back to the planning chat with what you dislike.
- Changes come back as a short fix prompt, or as a numbered file in `kit/addenda/` for anything larger.
