"use strict";

const DEFAULT_SPEECH_INPUT_SETTINGS = Object.freeze({
  enabled: false,
  language: "zh",
  deviceId: "default",
});
const SPEECH_INPUT_LANGUAGES = Object.freeze(["zh", "en", "ja"]);
const SPEECH_INPUT_DEVICE_ID_MAX_LENGTH = 512;
const DEVICE_ID_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

function settingsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSpeechInputSettings(value) {
  const settings = settingsObject(value);
  const deviceId = settings.deviceId;
  return {
    enabled: settings.enabled === true,
    language: SPEECH_INPUT_LANGUAGES.includes(settings.language)
      ? settings.language
      : DEFAULT_SPEECH_INPUT_SETTINGS.language,
    // Device IDs are opaque browser identifiers, never file paths or commands.
    deviceId: typeof deviceId === "string" && deviceId.length > 0
      && deviceId.length <= SPEECH_INPUT_DEVICE_ID_MAX_LENGTH
      && !DEVICE_ID_CONTROL_CHARACTERS.test(deviceId)
      ? deviceId
      : DEFAULT_SPEECH_INPUT_SETTINGS.deviceId,
  };
}

function mergeSpeechInputSettings(previous, patch) {
  return normalizeSpeechInputSettings({ ...settingsObject(previous), ...settingsObject(patch) });
}

function getSpeechInputSettingsCatalog() {
  return {
    defaults: { ...DEFAULT_SPEECH_INPUT_SETTINGS },
    languages: [
      { id: "zh", label: "中文" },
      { id: "en", label: "English" },
      { id: "ja", label: "日本語" },
    ],
    deviceIdMaxLength: SPEECH_INPUT_DEVICE_ID_MAX_LENGTH,
  };
}

module.exports = {
  DEFAULT_SPEECH_INPUT_SETTINGS,
  SPEECH_INPUT_LANGUAGES,
  SPEECH_INPUT_DEVICE_ID_MAX_LENGTH,
  normalizeSpeechInputSettings,
  mergeSpeechInputSettings,
  getSpeechInputSettingsCatalog,
};
