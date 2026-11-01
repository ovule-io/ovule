import { GenerationControl } from "./GenerationControl";
import shellTokens from "@ovule/shell/shell.token";
import composerSuggestionsTokens from "../conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { Bot, ChevronDown, FolderOpen, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";

import { Button } from "@ovule/ui/button";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
} from "@ovule/ui/prompt-input";
import { Kbd } from "@ovule/ui/controls";
import { InputGroupButton } from "@ovule/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@ovule/ui/overlays";
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentPreview,
} from "@ovule/ui/attachment";
import { Alert, AlertDescription } from "@ovule/ui/alert";

import { cn } from "@ovule/ui/cn";
import type {
  AgentView,
  SkillView,
  SlashCommandContributionView,
  ThreadView,
  WorkspaceBindingView,
  HostView,
  HostWorkspaceResource,
  RemoteEndpointView,
} from "@ovule/shell-api";
import type { MessageImageDraft } from "./useMessageDraft";

import type { ComposerSuggestion } from "./suggestions";
import styles from "./MessageComposer.module.css";

type MessageComposerDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
  shell: ServiceOf<typeof shellTokens.shell>;
  suggestionRegistry: ServiceOf<typeof composerSuggestionsTokens.composerSuggestionRegistry>;
};

function MessageComposerContent({
  dependencies,
  props,
}: {
  dependencies: MessageComposerDependencies;
  props: {
    thread?: ThreadView;
    skills: SkillView[];
    messageText: string;
    setMessageText(value: string): void;
    messageImages: MessageImageDraft[];
    attachmentError?: string;
    addPastedImages(files: File[]): Promise<void>;
    removeMessageImage(id: string): void;
    sendingMessage: boolean;
    sendMessage(): Promise<void>;
    running?: boolean;
    stopping?: boolean;
    stopMessage?(): Promise<void>;
    workspacePath: string;
    clearWorkspace(): void;
    choosingWorkspace: boolean;
    chooseWorkspace(): Promise<string | undefined>;
    workspaceBindings: WorkspaceBindingView[];
    agents: AgentView[];
    hosts: HostView[];
    remoteHosts: RemoteEndpointView[];
    openHosts(): void;
    setWorkspaceBindings(bindingIds: string[]): Promise<void>;
    addLocalWorkspace(): Promise<void>;
    addRemoteWorkspace(
      endpoint: RemoteEndpointView,
      resource: HostWorkspaceResource,
    ): Promise<void>;
    draftAgentId: string;
    setDraftAgentId(value: string): void;
    selectAgent(agentId: string): void;
    workflowNodeThread?: boolean;
    hasMessages?: boolean;
  };
}) {
  const { native: isNative } = useService(shellTokens.shell);

  const i18n = useTranslation().i18n;

  const { workspace, shell, suggestionRegistry } = dependencies;
  const ApprovalModePicker = shell.agentApprovals?.ModePicker;
  const {
    thread,
    skills,
    messageText,
    setMessageText,
    messageImages,
    attachmentError,
    addPastedImages,
    removeMessageImage,
    sendingMessage,
    sendMessage,
    running = false,
    stopping = false,
    stopMessage,
    workspacePath,
    clearWorkspace,
    choosingWorkspace,
    chooseWorkspace,
    workspaceBindings,
    agents,
    hosts,
    remoteHosts,
    openHosts,
    setWorkspaceBindings,
    addLocalWorkspace,
    addRemoteWorkspace,
    draftAgentId,
    setDraftAgentId,
    selectAgent,
    workflowNodeThread = false,
  } = props;

  const command = /^\/([a-z0-9-]+)(?:\s|$)/i.exec(messageText)?.[1];
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [extensionCommands, setExtensionCommands] = useState<SlashCommandContributionView[]>([]);
  const commandSkills = extensionCommands.find((item) => item.id === command)?.skills ?? [];
  const commandSkill =
    skills.find((skill) => skill.enabled && skill.id === command) ??
    skills.find((skill) => skill.enabled && commandSkills.includes(skill.id));
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [attachmentPickerError, setAttachmentPickerError] = useState<string>();
  const selectedHostId = thread?.hostId ?? "local";
  const selectedHost = hosts.find((host) => host.id === selectedHostId);
  const agentsForSelectedHost = agents.filter((agent) => selectedHost?.agentIds.includes(agent.id));
  const selectedWorkspaceIds = new Set(
    (thread?.workspaceBindingIds ?? []).filter((id) =>
      workspaceBindings.some((binding) => binding.id === id && binding.hostId === selectedHostId),
    ),
  );
  const availableWorkspaceBindings = useMemo(() => {
    const seen = new Set<string>();
    return [...workspaceBindings]
      .filter((binding) => binding.hostId === selectedHostId)
      .sort(
        (left, right) =>
          Number(right.threadId === thread?.id) - Number(left.threadId === thread?.id),
      )
      .filter((binding) => {
        const key = `${binding.kind}\0${binding.endpointId ?? ""}\0${binding.root}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [selectedHostId, thread?.id, workspaceBindings]);
  useEffect(() => {
    let active = true;
    let running = false;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      dirty = true;
      if (!active || running || timer !== undefined) return;
      // Workspace revisions also include streaming output. Keep discovery off
      // that hot path and allow at most one catalog request at a time.
      timer = setTimeout(() => {
        timer = undefined;
        if (!active) return;
        running = true;
        dirty = false;
        void workspace
          .api()
          .then((api) => api.extensionCatalog())
          .then((catalog) => {
            if (active) setExtensionCommands(catalog.slashCommands);
          })
          .catch((error) => console.error("Failed to load extension slash commands", error))
          .finally(() => {
            running = false;
            if (active && dirty) refresh();
          });
      }, 500);
    };
    refresh();
    const stop = workspace.observeWorkspace(refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      stop();
    };
  }, [workspace]);
  const suggestions = useMemo(
    () =>
      suggestionRegistry.resolve({
        skills,
        extensionCommands,
        translate: (key) => t(key),
      }),
    [extensionCommands, skills, suggestionRegistry, t],
  );
  const slashQuery = slashCommandQuery(messageText);
  const filtered =
    slashQuery === undefined
      ? []
      : suggestions.filter(
          (suggestion) =>
            suggestion.id.includes(slashQuery) ||
            suggestion.label.toLocaleLowerCase().includes(slashQuery),
        );
  const menuOpen = !dismissed && slashQuery !== undefined;

  useEffect(() => setActiveIndex(0), [slashQuery]);
  const chooseSuggestion = (suggestion: ComposerSuggestion) => {
    setMessageText(suggestion.command);
    setDismissed(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(suggestion.command.length, suggestion.command.length);
    });
  };

  const chooseImages = async () => {
    if (!isNative && !shell.messageApi()) {
      attachmentInput.current?.click();
      return;
    }
    setAttachmentPickerError(undefined);
    try {
      const path = await (
        await shell.dialog()
      ).openFile({
        title: t("conversation.attachImages"),
        defaultPath: thread?.workspacePath || undefined,
        extensions: [["png", "jpg", "jpeg", "gif", "webp"]],
      });
      if (!path) return;
      if (!thread) {
        setAttachmentPickerError(t("conversation.attachImagesRequiresThread"));
        return;
      }
      const selected = await (await workspace.api()).readWorkspaceFile(thread.id, path);
      const mediaType = imageMediaType(selected.extension);
      const bytes = Uint8Array.from(selected.bytes);
      await addPastedImages([new File([bytes], selected.name, { type: mediaType })]);
    } catch (error) {
      setAttachmentPickerError(
        error instanceof Error ? error.message : t("conversation.attachImagesFailed"),
      );
    }
  };

  return (
    <PromptInput
      className={cn("composer", styles.root)}
      onSubmit={(event) => {
        event.preventDefault();
        if ((!messageText.trim() && !messageImages.length) || sendingMessage) return;
        if (!running) void sendMessage();
      }}
    >
      {menuOpen && (
        <div
          className={styles.menu}
          role="listbox"
          aria-label={t("conversation.skillCommands")}
          id="composer-skill-suggestions"
        >
          <header className={styles.menuHeader}>
            <Sparkles size={14} />
            <span className={styles.menuTitle}>{t("conversation.skillCommands")}</span>
            <Kbd className={styles.menuShortcut}>↑↓</Kbd>
            <Kbd className={styles.menuShortcut}> {i18n.t("composer.enter")} </Kbd>
          </header>
          {filtered.length ? (
            filtered.map((suggestion, index) => (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(styles.option, index === activeIndex && styles.activeOption)}
                id={`composer-suggestion-${suggestion.id}`}
                key={suggestion.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseSuggestion(suggestion)}
              >
                <code className={styles.optionCommand}>/{suggestion.id}</code>
                <span className={styles.optionText}>
                  <strong className={cn(styles.optionLine, styles.optionTitle)}>
                    {suggestion.label}
                  </strong>
                  <small className={cn(styles.optionLine, styles.optionDescription)}>
                    {suggestion.description}
                  </small>
                </span>
              </Button>
            ))
          ) : (
            <p className={styles.empty}>{t("conversation.noSkillCommands")}</p>
          )}
        </div>
      )}
      {!props.hasMessages && !workflowNodeThread && (
        <div className={styles.suggestionBar}>
          <span className={styles.suggestionLabel}>{t("conversation.suggestions")}</span>
          <div className={styles.chips}>
            {suggestions.map((suggestion) => (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className={styles.chip}
                data-suggestion={suggestion.id}
                title={suggestion.description}
                key={suggestion.id}
                onClick={() => chooseSuggestion(suggestion)}
              >
                {suggestion.onboarding && <Sparkles size={11} />}
                {suggestion.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <PromptInputBody className={styles.inputGroup}>
        {commandSkill && (
          <button
            type="button"
            className={styles.skillLink}
            title={commandSkill.description}
            onClick={() =>
              void shell.requestRoot("workbench.open", {
                kind: "markdown",
                target: `skill:${commandSkill.id}`,
              })
            }
          >
            /{command}
          </button>
        )}
        <PromptInputTextarea
          className={styles.composerInput}
          ref={input}
          aria-label={t("conversation.messageLabel")}
          aria-autocomplete="list"
          aria-controls={menuOpen ? "composer-skill-suggestions" : undefined}
          aria-expanded={menuOpen}
          aria-activedescendant={
            menuOpen && filtered[activeIndex]
              ? `composer-suggestion-${filtered[activeIndex].id}`
              : undefined
          }
          value={messageText}
          onFocus={() => setDismissed(false)}
          onBlur={() => setDismissed(true)}
          onChange={(event) => {
            setDismissed(false);
            setMessageText(event.target.value);
          }}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.items)
              .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file));
            if (!images.length) return;
            event.preventDefault();
            void addPastedImages(images);
          }}
          placeholder={
            thread
              ? t("conversation.message", { agent: thread.agent })
              : t("conversation.describeWork")
          }
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (menuOpen && filtered.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex((index) => (index + direction + filtered.length) % filtered.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                chooseSuggestion(filtered[activeIndex] ?? filtered[0]);
                return;
              }
            }
            if (event.key === "Escape" && menuOpen) {
              event.preventDefault();
              setDismissed(true);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {messageImages.length > 0 && (
          <AttachmentGroup
            className={styles.attachments}
            aria-label={t("conversation.pastedImages")}
          >
            {messageImages.map((image) => (
              <Attachment className={styles.attachment} key={image.id}>
                <AttachmentPreview
                  className={styles.attachmentPreview}
                  src={image.previewUrl}
                  alt={image.name}
                />
                <AttachmentContent className={styles.attachmentCaption}>
                  {image.name}
                </AttachmentContent>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className={styles.attachmentRemove}
                  aria-label={t("conversation.removeImage", {
                    name: image.name,
                  })}
                  title={t("conversation.removeImage", { name: image.name })}
                  onClick={() => removeMessageImage(image.id)}
                >
                  <X size={12} />
                </Button>
              </Attachment>
            ))}
          </AttachmentGroup>
        )}
        {(attachmentError || attachmentPickerError) && (
          <Alert className={styles.attachmentError}>
            <AlertDescription>
              {attachmentError ? t(`conversation.${attachmentError}`) : attachmentPickerError}
            </AlertDescription>
          </Alert>
        )}
        <PromptInputFooter className={styles.actions}>
          <div className={styles.leadingActions}>
            <Input
              ref={attachmentInput}
              className={styles.attachmentInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              tabIndex={-1}
              onChange={(event) => {
                const images = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (images.length) void addPastedImages(images);
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  className={styles.plusButton}
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={t("conversation.addAttachment")}
                >
                  <Plus size={16} />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem onSelect={() => void chooseImages()}>
                  {t("conversation.attachImages")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className={styles.context}>
              {thread && (
                <DropdownMenu
                  open={workspaceMenuOpen}
                  onOpenChange={setWorkspaceMenuOpen}
                  modal={false}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      className={styles.contextButton}
                      variant="ghost"
                      size="sm"
                      type="button"
                    >
                      <FolderOpen size={14} />
                      {selectedWorkspaceIds.size
                        ? t("conversation.workspaceCount", {
                            count: selectedWorkspaceIds.size,
                          })
                        : t("conversation.optionalWorkspace")}
                      <ChevronDown size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    className={styles.workspaceMenu}
                    aria-label={t("conversation.selectWorkspaces")}
                  >
                    {availableWorkspaceBindings.map((binding) => (
                      <DropdownMenuCheckboxItem
                        className={styles.workspaceOption}
                        key={binding.id}
                        checked={selectedWorkspaceIds.has(binding.id)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => {
                          const next = selectedWorkspaceIds.has(binding.id)
                            ? [...selectedWorkspaceIds].filter((id) => id !== binding.id)
                            : [...selectedWorkspaceIds, binding.id];
                          void setWorkspaceBindings(next);
                        }}
                      >
                        <span className={styles.workspaceOptionText}>
                          <span className={styles.workspaceAlias}>{binding.alias}</span>
                          <small className={cn(styles.workspaceOptionLine, styles.workspaceDetail)}>
                            {binding.kind.toUpperCase()} · {binding.root}
                            {selectedWorkspaceIds.has(binding.id)
                              ? i18n.t("composer.attached")
                              : i18n.t("composer.connected")}
                          </small>
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                    {remoteHosts.length > 0 && (
                      <div className={styles.remoteWorkspaceGroup} data-remote-host-workspaces>
                        <span className={styles.workspaceGroupLabel}>
                          {" "}
                          {i18n.t("composer.remoteHosts")}{" "}
                        </span>
                        {remoteHosts.flatMap((endpoint) =>
                          endpoint.workspaces.length ? (
                            endpoint.workspaces.map((resource) => (
                              <DropdownMenuItem
                                className={styles.remoteWorkspaceOption}
                                key={`${endpoint.id}:${resource.shareId}`}
                                onSelect={() => {
                                  setWorkspaceMenuOpen(false);
                                  void addRemoteWorkspace(endpoint, resource);
                                }}
                              >
                                <span>{resource.alias}</span>
                                <small>
                                  {endpoint.displayName} · {resource.root}
                                </small>
                              </DropdownMenuItem>
                            ))
                          ) : (
                            <DropdownMenuItem
                              className={styles.remoteWorkspaceOption}
                              key={endpoint.id}
                              onSelect={() => {
                                setWorkspaceMenuOpen(false);
                                openHosts();
                              }}
                            >
                              <span>{endpoint.displayName}</span>
                              <small> {i18n.t("composer.noGrantedWorkspaces")} </small>
                            </DropdownMenuItem>
                          ),
                        )}
                      </div>
                    )}
                    <div
                      data-workspace-menu-actions
                      data-separated={remoteHosts.length > 0 || undefined}
                      className={cn(
                        styles.workspaceMenuActions,
                        remoteHosts.length > 0 && styles.workspaceMenuActionsSeparated,
                      )}
                    >
                      <DropdownMenuItem
                        className={styles.workspaceMenuAction}
                        onSelect={() => {
                          setWorkspaceMenuOpen(false);
                          openHosts();
                        }}
                      >
                        <Plus size={13} /> {i18n.t("composer.manageRemoteHosts")}{" "}
                      </DropdownMenuItem>
                      {selectedHostId === "local" && (
                        <DropdownMenuItem
                          className={styles.workspaceMenuAction}
                          onSelect={() => {
                            setWorkspaceMenuOpen(false);
                            void addLocalWorkspace();
                          }}
                        >
                          <FolderOpen size={13} /> {i18n.t("composer.addLocalWorkspace")}{" "}
                        </DropdownMenuItem>
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {!thread && (
                <Button
                  type="button"
                  className={styles.contextButton}
                  size="sm"
                  variant="ghost"
                  disabled={choosingWorkspace}
                  aria-label={t("conversation.chooseWorkspace")}
                  onClick={() => void chooseWorkspace()}
                >
                  <FolderOpen size={14} />
                  {workspacePath
                    ? workspacePath.split(/[\\/]/).at(-1)
                    : t("conversation.optionalWorkspace")}
                </Button>
              )}
              {!thread && workspacePath && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className={styles.clearWorkspace}
                  aria-label={t("conversation.clearWorkspace")}
                  onClick={clearWorkspace}
                >
                  <X size={12} />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <InputGroupButton
                    className={styles.contextButton}
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label={t(
                      workflowNodeThread
                        ? "conversation.workflowNodeThreadAgent"
                        : "conversation.threadAgent",
                    )}
                  >
                    <Bot size={14} />
                    {agentsForSelectedHost.find(
                      (agent) => agent.id === (thread?.agent ?? draftAgentId),
                    )?.label ?? t("conversation.chooseAgent")}
                    <ChevronDown size={12} />
                  </InputGroupButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end">
                  <DropdownMenuRadioGroup
                    value={(thread?.agent ?? draftAgentId) || ""}
                    onValueChange={(value) => {
                      setDraftAgentId(value);
                      selectAgent(value);
                    }}
                  >
                    {agentsForSelectedHost.length === 0 && (
                      <DropdownMenuItem disabled>
                        {t("conversation.noAgentsOnHost")}
                      </DropdownMenuItem>
                    )}
                    {agentsForSelectedHost.map((agent) => {
                      const available =
                        agent.enabled &&
                        (agent.available ||
                          (selectedHostId !== "local" && agent.driver !== "ovule"));
                      return (
                        <DropdownMenuRadioItem
                          key={agent.id}
                          value={agent.id}
                          disabled={!available}
                        >
                          {agent.label}
                          {available ? "" : ` · ${t("conversation.unavailable")}`}
                        </DropdownMenuRadioItem>
                      );
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {ApprovalModePicker && <ApprovalModePicker translate={t} />}
            </div>
          </div>
          <GenerationControl
            running={running}
            stopping={stopping}
            sending={sendingMessage}
            canSend={Boolean(messageText.trim() || messageImages.length)}
            onStop={stopMessage}
            translate={t}
            className={styles.sendButton}
          />
        </PromptInputFooter>
      </PromptInputBody>
    </PromptInput>
  );
}

export const MessageComposerFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const shell = dependsOn(shellTokens.shell);
  const suggestionRegistry = dependsOn(composerSuggestionsTokens.composerSuggestionRegistry);
  const dependencies = { workspace, shell, suggestionRegistry };
  return function MessageComposer(props: {
    thread?: ThreadView;
    skills: SkillView[];
    messageText: string;
    setMessageText(value: string): void;
    messageImages: MessageImageDraft[];
    attachmentError?: string;
    addPastedImages(files: File[]): Promise<void>;
    removeMessageImage(id: string): void;
    sendingMessage: boolean;
    sendMessage(): Promise<void>;
    running?: boolean;
    stopping?: boolean;
    stopMessage?(): Promise<void>;
    workspacePath: string;
    clearWorkspace(): void;
    choosingWorkspace: boolean;
    chooseWorkspace(): Promise<string | undefined>;
    workspaceBindings: WorkspaceBindingView[];
    agents: AgentView[];
    hosts: HostView[];
    remoteHosts: RemoteEndpointView[];
    openHosts(): void;
    setWorkspaceBindings(bindingIds: string[]): Promise<void>;
    addLocalWorkspace(): Promise<void>;
    addRemoteWorkspace(
      endpoint: RemoteEndpointView,
      resource: HostWorkspaceResource,
    ): Promise<void>;
    draftAgentId: string;
    setDraftAgentId(value: string): void;
    selectAgent(agentId: string): void;
    workflowNodeThread?: boolean;
    hasMessages?: boolean;
  }) {
    return createElement(MessageComposerContent, { dependencies, props });
  };
}, "MessageComposer");

export const MessageComposer = (...args: Parameters<ServiceOf<typeof MessageComposerFactory>>) =>
  createElement(useService(MessageComposerFactory), ...args);

function slashCommandQuery(value: string): string | undefined {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("/")) return undefined;
  const command = trimmed.slice(1);
  if (/\s/.test(command)) return undefined;
  return command.toLocaleLowerCase();
}

function imageMediaType(extension: string): string {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  return "image/png";
}
