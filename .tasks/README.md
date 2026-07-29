# Task trackers

One markdown file per piece of work that outlives a single session.

**Why these exist.** A session ends — context runs out, a day ends, an agent is
swapped — and everything it worked out that is not in the code or the docs dies
with it. Git records *what* changed; specs record *what the game should do*.
Neither records "I have measured three of the five cases, the second one is
suspicious for this reason, and here is the exact command that reproduces it".
That is what gets rediscovered from scratch every time, at full cost.

## The rules

- **One file per task**, named after the task: `.tasks/block-vs-bullets.md`.
- **Update it as you go, not at the end.** A tracker written up after the fact is
  a summary; the point is to be able to stop *mid-step* and resume.
- **Record measurements, not intentions.** "Ran `training-probe.mjs`, 12/12,
  impacts 34" is worth keeping. "Will run the probe next" is not.
- **Say what is decided and what is still open**, and why. The open questions are
  the expensive part to rebuild.
- **Delete the file when the work lands**, and fold anything durable into
  `specs/`, `docs/invariants.md` or a skill. A tracker is scaffolding — leaving
  it behind turns it into a second, staler source of truth, which is exactly what
  `specs/README.md` warns against.

## The shape

```markdown
# <task>            — issue link, branch, status line
## Decision         — what was settled, and why
## Open questions   — what is not settled, and what would settle it
## Plan             — numbered steps, each independently verifiable
## Progress log     — newest last: what was done, what was measured
## Resume here      — the single next action, in one sentence
```

**`Resume here` is the load-bearing section.** It is the first thing the next
session reads and the only one that must always be current.
