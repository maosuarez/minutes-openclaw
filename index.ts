// minutes-openclaw plugin entry point — registers Minutes as a local
// MediaUnderstandingProvider so any OpenClaw channel gets whisper.cpp
// transcription without sending audio to the cloud.
import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import { minutesMediaUnderstandingProvider } from "./src/provider.js";

const entry: OpenClawPluginDefinition = definePluginEntry({
  id: "minutes",
  name: "Minutes",
  description: "Local whisper.cpp audio transcription via the Minutes CLI",
  register(api) {
    api.registerMediaUnderstandingProvider(minutesMediaUnderstandingProvider);
  },
});

export default entry;
