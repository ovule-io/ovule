import type { SkillView, SlashCommandContributionView } from "@ovule/shell-api";
import type {
  ComposerSuggestion,
  ComposerSuggestionContext,
  ComposerSuggestionProvider,
  ComposerSuggestionRegistry,
} from "./suggestions";

export function createComposerSuggestionRegistry(): ComposerSuggestionRegistry {
  const providers = new Set<ComposerSuggestionProvider>();
  return {
    register(provider) {
      providers.add(provider);
      return () => providers.delete(provider);
    },
    resolve(context) {
      const suggestions = [...providers].flatMap((provider) => [...provider(context)]);
      return [...new Map(suggestions.map((suggestion) => [suggestion.id, suggestion])).values()];
    },
  };
}
