import { describe, expect, test } from "bun:test";

import { createComposerSuggestionRegistry } from "./suggestions-contract";
import { defaultComposerSuggestions } from "./suggestion-service";

describe("composer suggestion registry", () => {
  test("combines providers and lets later providers replace an id", () => {
    const registry = createComposerSuggestionRegistry();
    registry.register(() => [{ id: "one", label: "One", description: "", command: "/one " }]);
    registry.register(() => [{ id: "one", label: "Override", description: "", command: "/one " }]);
    expect(
      registry.resolve({
        skills: [],
        extensionCommands: [],
        translate: String,
      }),
    ).toEqual([{ id: "one", label: "Override", description: "", command: "/one " }]);
  });

  test("offers the Agent-planned Goal command", () => {
    expect(
      defaultComposerSuggestions({
        skills: [],
        extensionCommands: [],
        translate: String,
      })[0],
    ).toMatchObject({ id: "goal", command: "/goal " });
  });
});
