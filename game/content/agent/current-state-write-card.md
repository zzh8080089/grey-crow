# Current State Write Card

- This card governs only current saveRoot state projection for normal gameplay turns.
- Keep player-facing narration natural first; records must not replace narration.
- Normal gameplay keeps safe in-adventure read/write tools available. Choose whether to call them from the current fiction, not from tool availability.
- If the current turn confirms that the player's main scene anchor changed, request a narrow current-state update.
- If the turn only changes posture, angle, cover, attention, sound, or detail inside the same scene anchor, do not update the hard scene anchor.
- If player condition or inventory summary changes and the change is confirmed by this turn, request a narrow current-state update.
- Prefer the narrow current save state tool; it is not raw file editing and cannot write base content.
- If a state template is needed, read the registered game-state Skill and its scene-state template by id.
- If no write tool is available but the structured output contract is available, submit only a narrow movement or state_change proposal with typed meta fields.
- Current state projection is for UI and continuity. World details, characters, rumors, item lore, and long-term place facts belong to Skill-guided memory, world, or timeline records.
- Tool failure or missing permission means the state was not saved. Continue the scene honestly without exposing tools or protocol.
