---
name: knowledge-sharpener
description: "Use at the END of any substantial session — after a refactor, a bug hunt, a physics fix, or anything that changed how the project works — to fold what was learned back into AGENTS.md and the affected SKILL.md files, and to verify every skill is indexed in AGENTS.md. Triggers on: end of session, wrap up, update the docs, update AGENTS.md, sharpen knowledge, post-session, what did we learn, knowledge upkeep, skill index."
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
# Every skill on disk
ls -1 .agents/skills | tr -d / | sort

# Every skill currently indexed
grep -ohE '`[a-z0-9-]+`' AGENTS.md | tr -d '`' | sort -u
```

Any name in the first list and not the second needs a pointer line added. Any
name in the second and not the first is a dangling reference — remove it.

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

If the second answer is no, the session is not finished.
