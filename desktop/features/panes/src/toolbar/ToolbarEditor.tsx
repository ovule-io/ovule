import omniboxTokens from "@ovule/omnibox/omnibox.token";
import { useMemo } from "react";
import { useService } from "@ovule/ioc/react";
import { useTranslation } from "react-i18next";
import { Input } from "@ovule/ui/form";
import { InputGroup } from "@ovule/ui/input-group";
import { Search } from "lucide-react";
import { cn } from "@ovule/ui/cn";
import type { ToolbarModel } from "./useToolbarModel";
import styles from "./PaneToolbar.module.css";

export function ToolbarEditor({
  model,
  selectOnFocus = false,
}: {
  model: ToolbarModel;
  selectOnFocus?: boolean;
}) {
  const Editor = model.active?.kind === "browser" ? BrowserAddressEditor : PaneSearchEditor;
  return <Editor model={model} selectOnFocus={selectOnFocus} />;
}
function BrowserAddressEditor({
  model,
  selectOnFocus,
}: {
  model: ToolbarModel;
  selectOnFocus: boolean;
}) {
  const Omnibox = useService(omniboxTokens.omniboxView);
  const { t } = useTranslation();
  const { active, address, setAddress, submit } = model;
  const tabSuggestions = useMemo(
    () =>
      model.tabs
        .filter(
          (tab) =>
            tab.kind === "browser" &&
            tab.id !== active?.id &&
            /^(https?|file):/.test(tab.url ?? tab.target ?? ""),
        )
        .map((tab) => ({
          id: `tab-${tab.id}`,
          kind: "tab",
          title: tab.title,
          detail: tab.url ?? tab.target ?? "",
          target: tab.url ?? tab.target ?? "",
        })),
    [model.tabs, active?.id],
  );
  return (
    <Omnibox
      additionalSuggestions={tabSuggestions}
      className={cn("pane-omnibox", styles.paneOmnibox)}
      inputClassName={styles.paneOmniboxInput}
      contentClassName={cn(
        "pane-omnibox-dropdown",
        styles.paneDropdown,
        styles.paneOmniboxDropdown,
      )}
      suggestionClassName={cn(styles.titlebarButton, styles.paneDropdownButton)}
      activeSuggestionClassName={styles.paneDropdownSelected}
      suggestionTitleClassName={cn(styles.paneText, styles.paneTitle)}
      suggestionDetailClassName={cn(styles.paneText, styles.paneSubtitle)}
      autoFocus
      selectOnFocus={selectOnFocus}
      leadingIcon={<Search size={16} />}
      formatTitle={(suggestion) =>
        t(`browser.suggestion.${suggestion.kind}`, {
          target: suggestion.target,
          defaultValue: suggestion.title,
        })
      }
      formatDetail={(suggestion) =>
        t(`browser.suggestionDetail.${suggestion.kind}`, { defaultValue: suggestion.detail })
      }
      inputRole="combobox"
      value={address}
      onValueChange={setAddress}
      onSubmit={(value) => void submit(value)}
      onAccept={(suggestion) => void submit(suggestion.target)}
      threadId={active?.threadId}
      ariaLabel={t("browser.address")}
      placeholder=""
      suggestionsId="pane-suggestions"
      initialActive={-1}
    />
  );
}
function PaneSearchEditor({ model }: { model: ToolbarModel }) {
  const { t } = useTranslation();
  const { address, setAddress, submit } = model;
  return (
    <InputGroup className={cn("pane-omnibox", styles.paneOmnibox)}>
      <Input
        className={styles.paneOmniboxInput}
        autoFocus
        role="combobox"
        aria-label={t("terminal.find")}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit(address);
          }
        }}
      />
    </InputGroup>
  );
}
