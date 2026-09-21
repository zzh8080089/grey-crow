"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Tutorial acknowledgement belongs to this installation, never to an adventure.
// Keep it separate from settings so resetting it cannot change connection drafts,
// voice preferences or a player's story.
function createTutorialStore({ dataRoot, topic = "intro" }) {
  if (!["intro", "game-ui"].includes(topic)) throw new TypeError("INVALID_TUTORIAL_TOPIC");
  const filePath = path.join(dataRoot, topic === "game-ui" ? "game-tour-progress.json" : "tutorial-progress.json");
  const initial = () => ({ version: 1, dismissed: false });
  return {
    read() {
      let stat;
      try { stat = fs.lstatSync(filePath); }
      catch (error) { if (error.code === "ENOENT") return initial(); throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 1024) {
        throw new Error("TUTORIAL_PROGRESS_UNREADABLE");
      }
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (value?.version !== 1 || typeof value.dismissed !== "boolean") {
        throw new Error("TUTORIAL_PROGRESS_UNREADABLE");
      }
      return { version: 1, dismissed: value.dismissed };
    },
    setDismissed(dismissed) {
      if (typeof dismissed !== "boolean") throw new TypeError("INVALID_TUTORIAL_PROGRESS");
      const value = { version: 1, dismissed };
      fs.mkdirSync(dataRoot, { recursive: true });
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(value) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
        fs.renameSync(temporary, filePath);
      } finally {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      return value;
    },
  };
}

module.exports = { createTutorialStore };
