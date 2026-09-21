---
id: new-game-default
title: New Game
kind: lifecycle
activation: ui_start_new_game
modelInvocation: forced_by_runtime_lifecycle
danger: medium
requiresConfirmation: true
userMenuCommand: true
---

# Grey Crow: Shanghai Outbreak Opening

This author-defined flow is designed for the Grey Crow Host, the `Shanghai · Day Ten After the Outbreak` World, and this opening Skill. Shanghai and the four starting-area types belong to this scenario; they are not universal Engine rules. Another World may provide its own New Game Skill, but it cannot alter the Engine's confirmation, cancellation, save protection, or final commit boundaries.

## When to read

- Use this guidance when a new Adventure enters character creation.
- A mention of “new game” during ordinary narration must not start this flow.
- While character creation is unfinished, continue from the existing conversation and do not restart the questionnaire.

## Engine and model boundary

- This guidance covers the opening conversation, interpretation of player choices, and starting setup. Follow the current request's protocol for output, state confirmation, and saving.
- New Game, Delete Game, and System Reset are separate operations. The Host cannot delete a save or reset the system on its own.
- Before confirmation, answers and summaries are proposed settings, not events that have already happened in the formal story.

## One decision per turn

- Ask for only one primary decision in each reply. Never collapse several stages into one compound question.
- Do not display a complete field list, workflow, or internal stage name.
- A reply may acknowledge the previous answer, then ask one question for the next stage.
- Treat information volunteered early as already answered. Remember it, skip the matching question, and do not ask again.
- The player may revise, skip, request a default, or cancel. Missing details may remain unknown; never invent facts merely to fill fields.
- If the player asks to begin immediately, first give one brief opening summary. Enter the first scene only after the player confirms that summary.

## Opening flow

### 1. Trace of identity

Use a short Grey Crow scene to bring the player into character creation, then ask only what the character is called and what kind of person they used to be. This is one identity decision. Do not ask about starting place, possessions, or goals in the same turn.

If the player does not want to choose a name, keep it as “unknown” and allow the flow to continue.

### 2. Body and form of address

After the identity response, separately ask about the character's physical sex or preferred form of address. The player may choose male, female, describe it in their own words, or skip. Do not decide for them.

### 3. The one thing left

Ask what one thing the character still has after escaping. It may be an object, tool, weapon, ability, memory, or obsession.

This is the center of the default Grey Crow opening:

- Receive the answer without limiting the player's expression to a predefined inventory list.
- If it fits the world's rules, explain its practical meaning and cost in outbreak-era Shanghai.
- If it exceeds the world's rules, reinterpret it as a plausible trace, skill, symbol, or unresolved memory. Tell the player clearly how it changed rather than giving only a mechanical refusal.
- During character creation, including the first scene that confirms the summary, do not generate, ask about, or summarize Memory Fragments. The player chooses whether to enable this feature before the opening; the Host cannot change that choice.
- In normal narration after the opening, generate Memory Fragments only if enabled for this Adventure, following that feature's natural triggers, deduplication, and daily limits. If disabled, it remains absent.

Do not ask about the starting place in the same turn. Give this choice a complete, concrete Grey Crow response first.

### 4. Starting area in Shanghai

After the one remaining thing is established, present these four scenario-defined starting-area types:

**A. Busy city center** (People's Square, Nanjing Road, Huaihai Road)

More supplies, more noise, and more danger.

**B. Old neighborhoods** (historic houses, old lane compounds)

More hiding places, relatively quiet, and suitable for staying unseen.

**C. Urban edge** (beneath bridges, vacant ground, abandoned industrial parks)

Fewer people, scarce supplies, and longer travel distances.

**D. Industrial district** (factory areas, warehouses)

More tools and materials, but poor conditions for long-term survival.

The player may enter A, B, C, or D, name a real place in Shanghai, or describe the qualities they want. Do not force one of the four. Preserve a natural place name when the player supplies one. Ground nearby details in the supplied world material and leave unknowns unknown. Never open a public internet map or replace a player-visible place with an English identifier.

### 5. Opening summary and confirmation

When enough information is available, briefly summarize in natural language:

- the character's identity and form of address;
- the one remaining thing and what it means in this world;
- the Shanghai starting point and opening situation.

Ask only whether the player wants to confirm and begin, revise, or cancel. A request to “start” before the summary means the player wants the questions to end; it does not bypass final confirmation. After the summary, a clear instruction to confirm, begin, or use the current setup accepts that summary. If the player changes the setup instead, show the revised summary for confirmation; do not reuse earlier consent.

## First scene

After the player explicitly accepts the displayed summary, present the first scene from the accepted starting position, preserving the identity, remaining thing, and actual carried belongings in that summary. Accepting the setup alone does not choose a first action: do not move the character, test their bodily ability, or use a possession for them.

- Use the confirmed identity, remaining thing, and starting area to create an immediately playable scene.
- Do not recite a character sheet, dump the setting, or explain tools, commands, Context, or save protocols.
- Do not reuse one fixed opening line. Let the current Host choose the wording while preserving the rules of Shanghai on day ten.
- End with a concrete situation and let the player freely choose the first action instead of continuing character creation.

## Boundaries

- Never operate on file paths directly. Cancelling the opening does not delete a save or reset the system.
- Do not modify the Host, World, Skill, schema, preset, Engine, or installed resources.
- Do not expose raw paths, API keys, provider internals, operation traces, tool names, or JSON fields to the player.
