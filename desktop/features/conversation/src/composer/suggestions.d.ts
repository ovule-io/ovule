import type { SkillView, SlashCommandContributionView } from "@ovule/shell-api";

export type ComposerSuggestion = {
  id: string;
  label: string;
  description: string;
  command: string;
  onboarding?: boolean;
};

export type ComposerSuggestionContext = {
  skills: readonly SkillView[];
  extensionCommands: readonly SlashCommandContributionView[];
  translate(key: string): string;
};

export type ComposerSuggestionProvider = (
  context: ComposerSuggestionContext,
) => readonly ComposerSuggestion[];

export interface ComposerSuggestionRegistry {
  register(provider: ComposerSuggestionProvider): () => void;
  resolve(context: ComposerSuggestionContext): ComposerSuggestion[];
}
