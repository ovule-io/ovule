import type { ComponentType, ReactNode, Ref } from "react";
import type { BrowserSuggestion } from "@ovule/shell-api";

export type OmniboxViewProps = {
  threadId?: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onAccept: (suggestion: BrowserSuggestion) => void;
  ariaLabel: string;
  placeholder: string;
  suggestionsId: string;
  className?: string;
  inputClassName?: string;
  contentClassName?: string;
  suggestionClassName?: string;
  activeSuggestionClassName?: string;
  suggestionTitleClassName?: string;
  suggestionDetailClassName?: string;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  inputRole?: "combobox";
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  suggestionsEnabled?: boolean;
  debounceMs?: number;
  initialActive?: number;
  formatTitle?: (suggestion: BrowserSuggestion) => string;
  formatDetail?: (suggestion: BrowserSuggestion) => string;
};

export type OmniboxViewTokenValue = ComponentType<OmniboxViewProps>;
