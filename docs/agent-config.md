# Agent Config Layout

Write once, run everywhere. One source of truth, symlinks for every other
tool's convention. Supported tools: **OpenCode** and **Claude Code**.

```
AGENTS.md                     # source of truth for project instructions
CLAUDE.md         -> AGENTS.md          (symlink)
.agents/skills/<name>/SKILL.md          # source of truth for all skills
.claude/skills    -> ../.agents/skills  (symlink, whole directory)
```

Why this works:
- **OpenCode** reads `AGENTS.md` natively and discovers skills in `.agents/skills/`, `.claude/skills/`, and `.opencode/skills/` — so it needs no symlink at all.
- **Claude Code** reads `CLAUDE.md` and only discovers project skills in `.claude/skills/` — both are satisfied by the symlinks above.
- The `.claude/skills` symlink points at the *directory*, not individual skills, so a new skill added to `.agents/skills/` shows up in both tools with **zero** extra setup.

## Rules
- **Never** edit `CLAUDE.md` or anything under `.claude/skills/` — they are symlinks. Edit `AGENTS.md` and `.agents/skills/` instead.
- **Never** create a real `CLAUDE.md` file or a real `.claude/skills/` directory; that forks the knowledge and the two tools drift apart.
- New skill = new folder `.agents/skills/<kebab-name>/SKILL.md`. Nothing else to wire up.
- Symlinks are committed to git (git stores them as symlinks), so a fresh clone works in both tools immediately.

## SKILL.md frontmatter (must satisfy both tools)
```yaml
---
name: kebab-case-name        # required, must equal the folder name, ^[a-z0-9]+(-[a-z0-9]+)*$
description: One line...     # required, when to use the skill + trigger keywords
---
```
Keep frontmatter to the fields both tools understand. Avoid tool-specific keys such as `compatibility:` (OpenCode-only) — they make a skill read as single-tool.

## Recreating the symlinks
```bash
ln -sfn AGENTS.md CLAUDE.md
mkdir -p .claude && ln -sfn ../.agents/skills .claude/skills
```

## Adding a third tool later
Point its expected path at the same source, e.g. Cursor: `ln -sfn ../.agents/skills .cursor/skills`. Do not copy files.
