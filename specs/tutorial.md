# The tutorial, and the campaign it is the first chapter of

**Status: implemented.**

A hero shooter built on GunZ' K-Style has a problem no menu solves: the moves
that make it worth playing — the butterfly, the guard break, the back massive,
the plunge bomb's catch — are invisible to somebody who has only ever pressed
attack. The move list *describes* them. This makes you do them.

The model is Cuphead's tutorial rather than a page of text: a **live opponent**
in front of you, a short piece of teaching, and objectives that only complete
when the game's own simulation says the move happened. Nothing is mimed, and
nothing is taken on trust — every objective is either a transition in your own
fighter's body or a decision the server already made.

## Where it lives

**The tutorial is the first thing on the root menu**, above Play, in its own
"Start here" section. It is not the gold primary button — Quick match keeps
that, because the primary action of a game is playing it — it wears the aim
beam's cyan instead, so it reads as a different kind of door rather than as a
competing one. The button names the hero currently picked, and once any lesson
is finished it carries a `4/16` badge: progress is remembered, and saying so is
what makes a half-finished course feel resumable.

Committing it writes `?tutorial=true&hero=<id>` and boots, exactly like every
other menu choice — the URL is still the authority (see [menu.md](menu.md)).

## What it runs on

**A tutorial is a training room with a director in front of it.** The room is
the practice room from [training-room.md](training-room.md): online, single
human, predicted and reconciled, with a **server-side scriptable dummy** for an
opponent. `Match` treats `?tutorial=true` as `?training=true` *and* a director;
the URL keeps them apart so a link that asks for practice gets the dummy's menu
and a link that asks for the course gets the coach.

That choice is the whole architecture, and it is worth stating why:

- **The enemy is already interactive.** A lesson about blocking hands the dummy
  `behaviour: "slash"`; a lesson about anti-air hands it `"jump"`; the
  graduation fight hands it `"counterAttack"` and takes its invincibility away.
  These are the practice room's own behaviours, played through the same netcode
  a human opponent would be.
- **A tutorial that simulated anything itself would teach a game nobody else is
  playing**, and would be the first thing to rot the day the real one changed.
- **The director cannot decide an outcome.** A hit is the server's; a dash is
  the simulation's. It stages, counts and reports.

The room runs with a **charge floor of 100** unless the URL says otherwise
(`?ultCharge=`), because a course that teaches the ultimate cannot ask a new
player to earn one first — the meter takes minutes and the lesson is the cast.
That floor is the practice room's own flag, not a second way to be armed.

## A lesson

One lesson is a **stage**, a **brief**, and **objectives**.

- The **stage** is an ordinary `TrainingConfigPatch`, merged over the training
  defaults and followed by a reset — so a lesson is a *complete* description of
  a room, never a delta on whatever the last one left behind. Every drill sets
  `playerInvincible` and `disableRoundReset`: a player who dies mid-lesson is a
  player whose objectives were reset by a respawn they did not ask for. Only
  the graduation fight lets the *dummy* die.
- The **brief** is one or two sentences of teaching, and it names buttons by
  their *action*. The overlay renders the player's real binding, so a rebound
  jump re-labels every instruction that mentions it.
- An **objective** is a count and a target: "land 3 slashes", "guard-break the
  dummy's swing twice", "cover 8 paces on foot". Its `count` is a **pure
  function of the lesson's counters**, which is what lets every lesson in every
  hero's course be checked in the unit suite with no browser.

A lesson closes when every objective is met, holds a `CLEARED` stamp for two
seconds, and moves on by itself. A chapter turn puts a full-screen chapter card
up first. Nothing blocks: **Reset** re-stages the drill and **Skip** abandons
it, always.

## The counters, and why they are transitions

The tracker exists because the obvious implementation is wrong. A tutorial that
counted **button presses** would tick "you dashed" for a dash the simulation
refused — on cooldown, rooted, mid-recovery — and congratulate the player for
something that never happened on screen.

So every movement counter is a **transition in the local fighter's own
predicted body**: a jump is leaving the ground *upward* (walking off a ledge is
not one), an air jump is the jump budget going down, a butterfly is a swing
that ended before its declared length with a guard already up. And every combat
counter is a **decision the server sent**: hits and backstabs by move, guard
breaks in each direction, blasts, bombs, roots, explosions.

Two of these are deltas rather than levels, and both bit during development:

- **The server's tallies are seeded at the moment a lesson arms**, not lazily
  at the first event. `training-state` is sent on change, so a lesson where
  nothing changes until the first big hit handed the tracker *that hit* as its
  baseline — the dragon thrust's 30 damage landed, became the opening figure,
  and "deal 20 damage" read 0/20 forever.
- **Item charges are read off the HUD**, which reports them every snapshot,
  rather than off the `item-charge` event, which fires on change. The first
  value a lesson ever saw was the count *after* the throw, so the first item
  use of every lesson was silently free.

## The courses

Sixteen lessons for Lia and Jeffs, twelve for Anands. Every id is hero-prefixed
— the basics read the same for all three, but a player picking up a new hero is
entitled to be walked through the feet again.

| Chapter | Lia | Anands | Jeffs |
|---|---|---|---|
| First steps | walk & jump · the second jump · the dash · two stances | same | same |
| The blade | slash · the chain · the guard · the butterfly · the uppercut vs a turtle · behind the guard · the Massive · the plunge bomb | stab · the thrust · the shoryuken · living in the gap | *(same as Lia)* |
| The arsenal | rifle · HE grenade · black hole | machine gun · trap · dragon thrust | shotgun · smoke · Death Blossom |
| Graduation | put down a counter-attacking dummy | same | same |

Anands' chapter is the one that cannot be shared: **the dagger has no guard**,
so every lesson the sword spends on blocking and the butterfly is spent here on
interrupting instead. Teaching the dagger against a sword's drill would teach
the wrong reflex — which is exactly why the training room lets the dummy change
hero.

## Progress

`localStorage`, under `golpe.campaign`, as a flat set of **lesson ids**. Never
the wire: progress is a property of this browser, not of a room, and a server
that owned it would mean a course that could not be played before a match
exists. Lesson ids are therefore required to be stable — reordering a chapter
must not un-finish anything, and renaming a lesson is a deliberate decision to
make people play it again.

## The campaign this is the first chapter of

The content layer is deliberately **data**, and the runtime knows nothing about
tutorials:

```
src/game/campaign/
  types.ts        the vocabulary: Objective, Lesson, Chapter, CampaignModule
  objectives.ts   the verbs a lesson is written in — every one pure
  signals.ts      LessonTracker: the counters, honest by construction
  progress.ts     what this browser has finished
  content/        the courses. common.ts is what Lia and Jeffs share
  TutorialDirector.ts   stage → count → report. No gameplay of its own.
```

A campaign act is **another `CampaignModule` in the registry**, whose chapters
carry `kind: "mission"`, built from the same objective builders and staged with
the same config patches. Nothing else has to change: the director runs whatever
module it is handed, the overlay renders whatever the director reports, and the
menu counts progress off the same lesson ids.

What a mission would need that a lesson does not: more than one opponent (the
practice room seats exactly one dummy), and a fail state (every drill is
deliberately unloseable). Both are additions to the *stage*, not to the
director — which is the point of keeping the stage an ordinary room description.

## Verification

`tsx scripts/tutorial-probe.ts` — the menu's top item boots the course, every
lesson in every hero's course stages the enemy it claims to (asked of the
*server's* echoed config, which is the one thing TypeScript cannot check), the
objectives tick, a finished lesson closes itself, and progress survives a
reload.

`tsx scripts/tutorial-probe.ts --play` is the row that answers the question the
tutorial exists for: **every drill is played to the end**, and the ones that
never clear are reported. An unreachable objective is the one tutorial bug with
no symptom — the lesson stages perfectly, the enemy does its thing, and the
player simply never gets to leave. Opt-in, because it plays forty-four drills at
human speed.

`src/game/campaign/Campaign.test.ts` covers what needs no browser: unique lesson
ids, reachable targets, no objective that is already satisfied by an empty
counter set, no drill that leaves the player mortal, and the tracker's
transitions.
