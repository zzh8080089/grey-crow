---
id: memory-fragment
title: Memory Fragments
kind: read-write
activation: model_can_invoke_for_active_recall_or_strong_association
modelInvocation: model_can_invoke
danger: medium
requiresConfirmation: false
userMenuCommand: false
---

# Memory Fragments

This is an optional narrative growth track chosen by the player. During deliberate exploration of the character's hazy personal past or a strongly associated scene, the host may append a hazy, unverified sensory fragment to this Adventure's module. The player can review progress, stage, four dimensions, and the complete list in the right-side extension slot.

These rules apply only when the player has chosen to enable Memory Fragments for this Adventure; being able to read them does not itself enable the track. Never confuse it with long-term memory retrieval, confirmed world facts, core identity, or Story Finale.

## When a fragment may emerge

- When the player explicitly explores the character's hazy personal past or origins, one Active Recall fragment may emerge.
- Recalling observations or conversations that already occurred in this Adventure is retrieval of prior events; it does not automatically create a new fragment about the character's past.
- When a person, object, smell, sound, movement, or place forms a strong association with the character's past, one Passive Association fragment may emerge.
- At most one Active Recall and one Passive Association fragment may be recorded per game day. Never generate one merely to increase progress.
- Daily allowances restrict new discoveries only. Reading or revisiting an existing fragment uses no discovery allowance and does not automatically create a new fragment. Details absent from its sources remain unknown.
- No fragments emerge during character creation or its confirmation turn; discovery begins only in free play after the opening has been confirmed.
- Do not repeat the same trigger, and do not add a new fragment that is highly similar to an existing one.
- Each fragment belongs to exactly one dimension: Body, Emotion, Skill, or Identity.

Ordinary rest, repeatedly checking the inventory, casually mentioning “before,” or trying to fill the track are not sufficient triggers. Skill trigger hints help discover these rules; they are not automatic generators.

## Writing a fragment

- Use two to four concrete but incomplete sensory sentences. They may include habitual movement, emotional response, sound, smell, touch, or a fleeting image.
- Keep certainty `uncertain`: a fragment suggests a possible past and is not a fact confirmed by an NPC, the World, or Semantic Memory.
- Do not reveal a complete biography or decide the player's real name, faction, guilt, family relationship, or unique identity for them.
- Never include model reasoning, prompts, file paths, tool activity, or source analysis in a fragment.

## Keep narration and records consistent

This text supplies narrative criteria. Available operations, fields, and recovery follow the current engine protocol; it defines no separate write tools or retry procedure.

- The complete content of each new fragment must appear with the same wording in this turn's player-visible narration. Describing only the trigger while hiding the fragment in a record is insufficient.
- Fragment records, the player's reconstruction choice, and their corresponding passages are validated and committed with the complete story turn, never written separately in advance. The engine manages IDs, dates, sources, and progress.
- Until the complete turn commits successfully, no new fragment or choice has taken effect and progress must not advance. The engine handles cancellation, failure, and retry.
- If a repair withdraws a new fragment or choice, also remove or revise the corresponding new fragment or completed-choice passage. Other valid narration may remain, but the complete turn must still commit successfully.
- The track holds at most 30 fragments. Do not bypass limits by changing the day, repeating triggers, or using another write path.

## Reconstructing memory

The 30th fragment only unlocks a natural moment of reconstruction; no reconstruction choice is made in that turn. In a later turn after the unlock has been committed, let the player choose freely through ordinary narration. A full track does not end the Adventure or prove the past is true. If the player has not clearly chosen, never decide for them:

- Accept the past: use `choice=accepted`. The player gains the title “Memory Restorer,” meaning they have deliberately accepted this account of self; it does not mean the system proved it as absolute history.
- Reject the past: use `choice=sealed`. Preserve every fragment as lived experience while explicitly allowing the player to release the past and choose and shape a new self. This is not a failure route and must carry no punishment.
- Defer the decision: use `choice=deferred`. The choice to accept or reject remains available when the player clearly confronts the past again.

Only after a clear choice in the current player input should that choice and its corresponding narration be submitted together under the current engine protocol. An earlier answer or an ambiguous expression is not a new choice.

`accepted` and `sealed` are both valid completions of this memory track. `deferred` keeps the choice open. None of them may rewrite core player identity fields, close the Adventure, or trigger Story Finale.

## Boundaries

- Read existing fragments as needed to check earlier triggers, similar content, or the basis for reconstruction. Omission from a summary does not erase a record. Never operate on files or write separate module progress.
- Do not copy fragments into confirmed character or world facts, or use them to grant items or abilities. If later events independently establish something, use that independent evidence.
- Do not modify another Skill, core state, World data, Content Snapshot, or Adventure lifecycle.
- Never expose internal tools, permissions, or error bodies to the player.
