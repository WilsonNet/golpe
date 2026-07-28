---
name: knowledge-sharpener
description: "Use at the END of any substantial session — after a refactor, a bug hunt, a physics fix, or anything that changed how the project works — to fold what was learned back into specs/, docs/, AGENTS.md and the affected SKILL.md files, to verify every skill is indexed in AGENTS.md, and to review this routine itself against how the session actually went. Triggers on: end of session, wrap up, update the docs, update AGENTS.md, sharpen knowledge, post-session, what did we learn, knowledge upkeep, skill index, improve the skill, review the skill."
license: MIT
---

# Knowledge Sharpener

Knowledge that only exists in a finished conversation is lost. This skill is the
routine that moves it into files the next session will actually load.

Run it **after** the work is verified, not instead of verifying it.

## When to run

Run after any session that:
- changed an architectural rule, invariant, or constant that others must respect
- fixed a bug whose *cause* was non-obvious (the cause is the knowledge, not the fix)
- added or moved a module, script, or workflow
- discovered a measurement, threshold, or diagnostic that should be reused
- added, renamed, or removed a skill

Skip it for trivial edits — a typo fix teaches nothing.

## The routine

### 1. Harvest what was actually learned

List the things that were **not** obvious at the start of the session. Be strict:
a fact belongs in the knowledge base only if a future agent would otherwise
re-derive it the hard way.

Good candidates:
- root causes ("the server rebuilt player state each tick, dropping wall contact")
- invariants ("visuals must be drawn from the collider data, never placed by hand")
- non-obvious numbers and *why* they hold ("jump height 136px — every ledge is
  spaced under it, so changing gravity changes level reachability")
- traps that produced a false result ("a dead server yields a diagnostic with no
  jitter, which reads as PASS")

Not candidates:
- what the code plainly says
- anything already in git history
- narration of the session

### 2. Update the docs closest to the knowledge

Prefer the most specific home:

| Knowledge | Goes in |
|---|---|
| What the game should *do* | `specs/` — the source of truth |
| A rule that was written by a real bug | `docs/invariants.md` |
| Where code lives and who owns it | `docs/architecture.md` |
| How to measure something | `docs/diagnostics.md` |
| A pointer every session needs | `AGENTS.md` — **one line, then a link** |
| Deep detail about one workflow | that workflow's `SKILL.md` |
| A number/threshold and its rationale | next to the constant, in code |

**`AGENTS.md` is an index, not a wiki.** It loads into every single session, so
prose there is a tax on all of them. If an entry needs a paragraph, it belongs in
`docs/` or `specs/` with a one-line pointer in `AGENTS.md`. Adding a section to
`AGENTS.md` is almost always the wrong move; adding a row to its "Where to look"
table is almost always the right one.

Rewrite stale lines rather than appending near-duplicates. **Delete** statements
the session proved wrong — a knowledge base with contradictions is worse than a
short one.

### 3. Verify every skill is indexed in AGENTS.md

`AGENTS.md` must carry one pointer line per skill, so both OpenCode and Claude
Code can see what knowledge exists without listing directories.

Regenerate and compare:

```bash
diff <(ls -1 .agents/skills | tr -d / | sort) \
     <(grep -oE '^- \*\*`[a-z0-9-]+`\*\*' AGENTS.md \
       | grep -oE '`[a-z0-9-]+`' | tr -d '`' | sort -u)
```

Only lines matching the Skills section's `- **\`name\`** — …` form count. An
earlier version of this check scraped *every* backticked word in `AGENTS.md`,
which cannot fail usefully: a skill missing from the index still "passed"
whenever its name appeared in backticks anywhere for an unrelated reason, and the
dangling-reference direction was pure noise. **A check that cannot fail is not a
check** — the same rule the `feedback-loop` skill applies to metrics.

Any name only on disk needs a pointer line added. Any name only in the index is a
dangling reference — remove it.

### 4. Check the symlinks still resolve

The write-once/run-everywhere layout depends on two symlinks. Confirm both:

```bash
readlink CLAUDE.md        # -> AGENTS.md
readlink .claude/skills   # -> ../.agents/skills
```

If either is a real file or directory instead of a symlink, the two tools have
forked and will drift. Fix per the "Agent Config Layout" section of AGENTS.md.

### 5. Sanity-check new skills

Each `SKILL.md` needs frontmatter both tools accept:

```yaml
---
name: kebab-case-name      # must equal the folder name
description: When to use it, plus trigger keywords
---
```

Avoid tool-specific keys (e.g. `compatibility:`), which make a skill read as
single-tool.

### 6. Sharpen the sharpener

**This file is part of the knowledge base, so every run of the routine is
evidence about the routine.** Fix it in the same commit as the rest — a step that
is only ever described as broken in a finished conversation is exactly the
knowledge this skill exists to stop losing.

Answer these before closing:

- **Did a step mislead, or pass when it should have failed?** Rewrite it and say
  what the old version let through. The index check in step 3 was replaced for
  precisely this: it scraped every backticked word and therefore could not fail.
- **Did the session produce knowledge with no home in step 2's table?** Add the
  row. A fact routed by guesswork lands somewhere nobody reloads.
- **Did you do something in the routine that is not written here?** That is the
  step you will forget next time.
- **Is a step now dead?** Delete it. A check nobody runs teaches the next agent
  that the checks are optional.

Two things this step is not. It is **not** a changelog — the git history of this
file already is one, and narrating the edit wastes the context every future
session pays for. And it is **not** an invitation to grow the file: if a step has
outgrown a paragraph, the detail belongs in `docs/`, with the step reduced to a
pointer. Prefer replacing a step over appending one.

## Quality bar

A good entry survives contact with a future session:

- **Causal, not procedural.** "Side collision was gated on `!grounded`, so a
  walking player passed through every platform" beats "fixed collision bug".
- **Falsifiable.** Include the number, the file, or the command.
- **Short.** If it needs three paragraphs, it belongs in a SKILL.md, and
  AGENTS.md gets the one-line pointer.

## Closing check

Before declaring the session done, confirm you can answer:

1. What would the next agent get wrong without this update?
2. Is that answer now written somewhere that gets loaded automatically?
3. What would the next agent get wrong about *this routine* — and is step 6's
   answer written down, or still only in this conversation?

If either of the last two answers is no, the session is not finished.
