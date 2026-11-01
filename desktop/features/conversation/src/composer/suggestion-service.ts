import type { ComposerSuggestionProvider } from "./suggestions";

export const defaultComposerSuggestions: ComposerSuggestionProvider = ({
  skills,
  extensionCommands,
  translate,
}) => [
  {
    id: "goal",
    label: translate("conversation.goalSuggestion"),
    description: translate("conversation.goalSuggestionDetail"),
    command: "/goal ",
  },
  {
    id: "onboarding",
    label: translate("conversation.onboardingSuggestion"),
    description: translate("conversation.onboardingSuggestionDetail"),
    command: "/onboarding ",
    onboarding: true,
  },
  ...skills
    .filter(
      (skill) =>
        skill.enabled &&
        skill.id !== "onboarding" &&
        !extensionCommands.some((command) => command.id === skill.id),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((skill) => ({
      id: skill.id,
      label: skill.name,
      description: skill.description,
      command: `/${skill.id} `,
    })),
  ...extensionCommands.map((command) => ({
    id: command.id,
    label: command.label,
    description: command.description,
    command: `/${command.id} `,
    onboarding: true,
  })),
];
