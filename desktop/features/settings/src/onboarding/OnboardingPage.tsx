import { IsolatedSetup } from "./IsolatedSetup";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { Check, KeyRound, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import { Combobox } from "@ovule/ui/combobox";

import type { OnboardingStatus } from "@ovule/shell-api";
import { useService } from "@ovule/ioc/react";
import { cn } from "@ovule/ui/cn";
import styles from "./OnboardingPage.module.css";

type Props = {
  threadId?: string;
  onComplete(): void;
};

import { onboardingReadiness } from "./flow";

type ModelProvider = string;

const isSelectableAgent = (
  agent: OnboardingStatus["agents"][number],
  setups: OnboardingStatus["setups"],
) =>
  agent.available ||
  agent.driver === "ovule" ||
  setups.some((setup) => setup.agentIds.includes(agent.id));

type OvuleProfileDraft = OnboardingStatus["agents"][number] & {
  driver: "ovule";
};

type OnboardingPageDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function OnboardingPageContent({
  dependencies,
  props,
}: {
  dependencies: OnboardingPageDependencies;
  props: Props;
}) {
  const { workspace } = dependencies;
  const { threadId, onComplete } = props;

  const { t } = useTranslation();
  const [status, setStatus] = useState<OnboardingStatus>();
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [providers, setProviders] = useState<Record<string, ModelProvider>>({});
  const [ovuleModelIds, setOvuleModelIds] = useState<Record<string, string>>({});
  const [ovuleProfileDrafts, setOvuleProfileDrafts] = useState<OvuleProfileDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [authBusy, setAuthBusy] = useState<string>();
  const [authProgress, setAuthProgress] = useState("");
  const cancelWaiting = useRef(false);

  const initialized = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const api = await workspace.api();
      const next = await api.onboardingStatus();
      setStatus(next);
      const selectableIds = new Set(
        next.agents
          .filter((agent) => isSelectableAgent(agent, next.setups))
          .map((agent) => agent.id),
      );
      const firstLoad = !initialized.current;
      const enabled = next.agents
        .filter((agent) => agent.enabled && agent.available)
        .map((agent) => agent.id);
      const fallback =
        next.models.find((model) => model.recommended && model.available)?.agentId ??
        next.agents.find((agent) => agent.available)?.id;
      const initialAgentIds = (
        next.defaultAgentId
          ? [...new Set([...enabled, next.defaultAgentId])]
          : fallback
            ? [fallback]
            : []
      ).filter((id) => selectableIds.has(id));
      if (initialAgentIds.length === 0 && fallback && selectableIds.has(fallback)) {
        initialAgentIds.push(fallback);
      }
      setAgentIds((current) => {
        const retained = current.filter(
          (id) => selectableIds.has(id) || /^ovule-(?:[2-9]|[1-9]\d+)$/.test(id),
        );
        return firstLoad ? initialAgentIds : retained;
      });
      setDefaultAgentId((current) => {
        if (firstLoad && next.defaultAgentId && initialAgentIds.includes(next.defaultAgentId)) {
          return next.defaultAgentId;
        }
        if (
          !firstLoad &&
          (selectableIds.has(current) || /^ovule-(?:[2-9]|[1-9]\d+)$/.test(current))
        ) {
          return current;
        }
        return initialAgentIds[0] ?? "";
      });
      setOvuleModelIds((current) => {
        const updated = { ...current };
        for (const agent of next.agents.filter((agent) => agent.driver === "ovule")) {
          if (firstLoad || !(agent.id in updated)) updated[agent.id] = agent.modelId ?? "";
        }
        return updated;
      });
      initialized.current = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initialized.current = false;
    void refresh();
    return () => {
      cancelWaiting.current = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!agentIds.includes(defaultAgentId)) setDefaultAgentId(agentIds[0] ?? "");
  }, [agentIds, defaultAgentId]);

  const allAgents = useMemo(
    () => [...(status?.agents ?? []), ...ovuleProfileDrafts],
    [status, ovuleProfileDrafts],
  );
  const providerSetups = status?.setups.filter((setup) => setup.modelProvider) ?? [];
  const connectionSetups =
    status?.setups.filter((setup) => !setup.modelProvider && setup.agentIds.length === 0) ?? [];
  const ovuleModels =
    status?.models.filter((model) =>
      providerSetups.some((setup) => setup.modelProvider === model.provider),
    ) ?? [];
  const readiness = onboardingReadiness(
    { agents: allAgents, models: ovuleModels, setups: status?.setups ?? [] },
    agentIds,
    defaultAgentId,
    ovuleModelIds,
  );
  const allModelsReady = readiness.complete;
  const profileProvider = (id: string) =>
    providers[id] ?? ovuleModels.find((model) => model.id === ovuleModelIds[id])?.provider;
  const selectProvider = (id: string, provider: string) => {
    setError(undefined);
    setProviders((current) => ({ ...current, [id]: provider }));
    if (profileProvider(id) !== provider) {
      setOvuleModelIds((current) => ({ ...current, [id]: "" }));
    }
  };

  const addOvuleProfile = () => {
    const used = new Set(allAgents.map((agent) => agent.id));
    let ordinal = 2;
    while (used.has(`ovule-${ordinal}`)) ordinal += 1;
    const id = `ovule-${ordinal}`;
    setOvuleProfileDrafts((current) => [
      ...current,
      {
        id,
        label: `Ovule ${ordinal}`,
        driver: "ovule",
        available: false,
        enabled: true,
        detail: t("onboarding.newOvuleProfile"),
        skillIds: [],
        toolIds: [],
        instructions: "",
      },
    ]);
    setAgentIds((current) => [...current, id]);
  };

  const toggleAgent = (id: string) => {
    setError(undefined);
    setAgentIds((current) => {
      if (current.includes(id)) {
        const next = current.filter((candidate) => candidate !== id);
        if (defaultAgentId === id) setDefaultAgentId(next[0] ?? "");
        return next;
      }
      const next = [...current, id];
      if (!defaultAgentId) setDefaultAgentId(id);
      return next;
    });
  };

  const complete = async () => {
    if (!allModelsReady || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await (
        await workspace.api()
      ).completeOnboarding({
        threadId,
        agents: agentIds.map((id) => {
          const agent = allAgents.find((candidate) => candidate.id === id);
          if (!agent) throw new Error(t("onboarding.unknownAgent", { id }));
          return {
            id: agent.id,
            label: agent.label,
            driver: agent.driver,
            modelId: agent.driver === "ovule" ? ovuleModelIds[id] : agent.modelId,
          };
        }),
        defaultAgentId,
      });
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const installToolchain = async (id: string, signal?: AbortSignal) => {
    const api = await workspace.api();
    const current = (await api.toolchainStatus()).find((item) => item.id === id);
    if (current?.available) return;
    for (const required of current?.requiredToolchainIds ?? [])
      await installToolchain(required, signal);
    setAuthProgress(t("onboarding.installingToolchain", { name: current?.label ?? id }));
    let toolchains = await api.installToolchain(id);
    let toolchain = toolchains.find((item) => item.id === id);
    for (
      let attempt = 0;
      attempt < 1_800 && toolchain?.installStatus === "installing";
      attempt += 1
    ) {
      if (cancelWaiting.current || signal?.aborted) throw new Error(t("onboarding.waitCancelled"));
      setAuthProgress(toolchain.detail);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      toolchains = await api.toolchainStatus();
      toolchain = toolchains.find((item) => item.id === id);
    }
    if (!toolchain?.available) {
      throw new Error(
        toolchain?.installError ?? t("onboarding.toolchainInstallationFailed", { id }),
      );
    }
  };

  const runSetupAction = async (
    setup: OnboardingStatus["setups"][number],
    action: OnboardingStatus["setups"][number]["actions"][number],
    profileId?: string,
    values?: Record<string, string>,
    signal?: AbortSignal,
  ) => {
    const key = setupKey(setup, profileId);
    const busyId = `${key}:${action.id}`;
    if (authBusy) return;
    cancelWaiting.current = false;
    setAuthBusy(busyId);
    setAuthProgress(t("onboarding.preparingSetup"));
    setError(undefined);
    try {
      for (const toolchain of action.requiredToolchains) await installToolchain(toolchain, signal);
      if (signal?.aborted) throw new Error(t("onboarding.waitCancelled"));
      const api = await workspace.api();
      setAuthProgress(t("onboarding.preparingSetup"));
      let next = await api.runExtensionSetupAction({
        extensionId: setup.extensionId,
        setupId: setup.id,
        actionId: action.id,
        values: setup.inputFields.map((id) => ({
          id,
          value: values?.[id] ?? "",
        })),
      });
      setStatus(next);
      if (next.authorizationUrl) {
        openProviderConsole(next.authorizationUrl, true);
        setAuthProgress(t("onboarding.finishSignInWorkbench"));
      }
      let completed = action.requiresAuthentication === false;
      for (let attempt = 0; !completed && attempt < 180; attempt += 1) {
        if (cancelWaiting.current || signal?.aborted)
          throw new Error(t("onboarding.waitCancelled"));
        const current = next.setups.find(
          (candidate) => candidate.extensionId === setup.extensionId && candidate.id === setup.id,
        );
        const modelReady =
          !setup.modelProvider ||
          !profileId ||
          next.models.some((model) => model.provider === setup.modelProvider && model.available);
        if (current?.status.authenticated && modelReady) {
          completed = true;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        next = await api.onboardingStatus();
        setStatus(next);
      }
      if (!completed) throw new Error(t("onboarding.setupTimedOut"));
      const providerModels =
        setup.modelProvider && profileId
          ? next.models.filter((model) => model.provider === setup.modelProvider && model.available)
          : [];
      const discovered = providerModels.find((model) => model.recommended) ?? providerModels[0];
      if (discovered) {
        setProviders((current) => ({
          ...current,
          [profileId!]: setup.modelProvider!,
        }));
        setOvuleModelIds((models) => ({
          ...models,
          [profileId!]: discovered.id,
        }));
      }
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setAuthBusy(undefined);
      setAuthProgress("");
    }
  };

  const openProviderConsole = (target: string, followNavigation = false) => {
    workspace.requestBrowserUse(target, undefined, followNavigation ? "allow" : "emit");
  };

  const cleanLegacyState = async () => {
    setLoading(true);
    setError(undefined);
    try {
      await (await workspace.api()).cleanOnboardingState();
      initialized.current = false;
      setAgentIds([]);
      setDefaultAgentId("");
      setOvuleProfileDrafts([]);
      setOvuleModelIds({});
      setProviders({});
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const canCleanLegacyState = Boolean(
    error && /Unsupported AgentDriver|unknown Agent|Model is unavailable/i.test(error),
  );

  const setupKey = (setup: OnboardingStatus["setups"][number], profileId?: string) =>
    `${profileId ?? "agent"}:${setup.extensionId}:${setup.id}`;
  const renderExtensionSetup = (setup: OnboardingStatus["setups"][number], profileId?: string) => (
    <IsolatedSetup
      key={`${setup.extensionId}:${setup.id}:${profileId ?? "agent"}`}
      setup={setup}
      busy={Boolean(authBusy)}
      onCancel={() => {
        cancelWaiting.current = true;
      }}
      progress={authBusy?.startsWith(`${setupKey(setup, profileId)}:`) ? authProgress : ""}
      onOpen={openProviderConsole}
      onAction={(id, values, signal) => {
        const action = setup.actions.find((candidate) => candidate.id === id);
        return action
          ? runSetupAction(setup, action, profileId, values, signal)
          : Promise.resolve(false);
      }}
    />
  );

  const content = (
    <div className={cn("onboarding-page", styles.onboardingPageContent)}>
      <header className={cn(styles.onboardingSection, styles.onboardingHeader)}>
        <div className="flex flex-row items-center gap-2">
          <div className={cn(styles.onboardingMark, "shrink-0")}>
            <Sparkles size={17} />
          </div>
          <h1 className="text-lg font-semibold">{t("onboarding.title")}</h1>
        </div>
        <p className="text-(--muted-foreground)">{t("onboarding.description")}</p>
      </header>
      <div className={cn("onboarding-body", styles.onboardingSection, styles.onboardingBody)}>
        {loading && !status ? (
          <div className={styles.onboardingLoading}>
            <LoaderCircle className="spin" />
            {t("onboarding.discovering")}
          </div>
        ) : (
          <section className={styles.onboardingAgents} aria-label={t("onboarding.agents")}>
            <div className={styles.onboardingSectionHeading}>
              <h2 className={styles.sectionHeadingTitle}>{t("onboarding.agents")}</h2>
              <span className={styles.sectionHeadingDescription}>{t("onboarding.agentsHint")}</span>
            </div>
            {allAgents.map((agent) => {
              const checked = agentIds.includes(agent.id);
              const selectable = isSelectableAgent(agent, status?.setups ?? []);
              const isDefault = defaultAgentId === agent.id;
              const builtin = agent.driver === "ovule";
              const provider = profileProvider(agent.id);
              const model = ovuleModels.find(
                (candidate) => candidate.id === ovuleModelIds[agent.id],
              );
              const ready =
                checked &&
                !readiness.pendingAgents.includes(agent.id) &&
                !readiness.pendingProfiles.includes(agent.id);
              const setups =
                status?.setups.filter((setup) => setup.agentIds.includes(agent.id)) ?? [];
              const missingTools = [
                ...new Set(
                  setups.flatMap((setup) =>
                    setup.actions.flatMap((action) => action.requiredToolchains),
                  ),
                ),
              ]
                .filter(
                  (id) => !status?.toolchains.some((item) => item.id === id && item.available),
                )
                .map((id) => status?.toolchains.find((item) => item.id === id)?.label ?? id);
              const activeSetup = providerSetups.find((setup) => setup.modelProvider === provider);
              return (
                <article
                  className={cn(styles.agentConfiguration, checked && styles.selected)}
                  key={agent.id}
                  aria-label={agent.label}
                >
                  <div className={styles.onboardingAgentCard}>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className={styles.onboardingAgentToggle}
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={t("onboarding.toggleAgent", {
                        agent: agent.label,
                      })}
                      disabled={!selectable || Boolean(authBusy) || submitting}
                      onClick={() => toggleAgent(agent.id)}
                    >
                      <span
                        className={cn(
                          styles.onboardingCheck,
                          checked && styles.onboardingCheckSelected,
                        )}
                      >
                        {checked && <Check size={12} />}
                      </span>
                      <span className={styles.agentText}>
                        <strong className={styles.agentTitle}>{agent.label}</strong>
                        <small className={styles.agentDescription}>
                          {builtin
                            ? t("onboarding.builtinHint")
                            : t("onboarding.extensionAgentHint")}
                        </small>
                      </span>
                    </Button>
                    {checked && (
                      <span
                        className={cn(styles.readiness, ready ? styles.ready : styles.needsSetup)}
                      >
                        {ready ? <Check size={12} /> : <KeyRound size={12} />}
                        {t(ready ? "onboarding.ready" : "onboarding.needsSetup")}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className={cn(styles.onboardingDefault, isDefault && styles.active)}
                      disabled={!checked || submitting}
                      aria-pressed={isDefault}
                      onClick={() => setDefaultAgentId(agent.id)}
                    >
                      {t(isDefault ? "onboarding.defaultAgent" : "onboarding.makeDefault")}
                    </Button>
                  </div>
                  {checked && (
                    <div className={styles.agentConfigurationBody}>
                      {builtin ? (
                        <>
                          <div className={styles.profileFields}>
                            <label className={styles.onboardingField}>
                              <span className={styles.fieldLabel}>{t("onboarding.provider")}</span>
                              <Combobox
                                value={provider}
                                options={providerSetups.map((setup) => ({
                                  value: setup.modelProvider!,
                                  label: setup.label,
                                }))}
                                onValueChange={(value) => selectProvider(agent.id, value)}
                                placeholder={t("onboarding.chooseModelProvider")}
                                searchPlaceholder={t("onboarding.searchProviders")}
                                emptyText={t("onboarding.noProviders")}
                                ariaLabel={t("onboarding.provider")}
                                className={styles.fieldControl}
                                disabled={Boolean(authBusy) || submitting}
                              />
                            </label>
                            <label className={styles.onboardingField}>
                              <span className={styles.fieldLabel}>{t("onboarding.model")}</span>
                              <Combobox
                                value={ovuleModelIds[agent.id]}
                                options={ovuleModels
                                  .filter((model) => model.provider === provider && model.available)
                                  .map((model) => ({
                                    value: model.id,
                                    label: model.label,
                                    description: model.detail,
                                  }))}
                                onValueChange={(value) =>
                                  setOvuleModelIds((current) => ({
                                    ...current,
                                    [agent.id]: value,
                                  }))
                                }
                                placeholder={t("onboarding.chooseModel")}
                                searchPlaceholder={t("onboarding.searchModels")}
                                emptyText={t("onboarding.noProviderModels")}
                                ariaLabel={t("onboarding.model")}
                                className={styles.fieldControl}
                                disabled={!provider || Boolean(authBusy) || submitting}
                              />
                            </label>
                          </div>
                          <small className={styles.fieldDescription}>
                            {model?.detail ??
                              t(
                                provider
                                  ? "onboarding.selectDiscoveredModel"
                                  : "onboarding.chooseProviderFirst",
                              )}
                          </small>
                          {activeSetup && renderExtensionSetup(activeSetup, agent.id)}
                        </>
                      ) : (
                        <>
                          {setups.map((setup) => renderExtensionSetup(setup))}
                          {!ready && (
                            <p className={styles.onboardingSelectionError}>
                              {missingTools.length
                                ? t("onboarding.installRequiredTools", {
                                    tools: missingTools.join(", "),
                                  })
                                : agent.available
                                  ? t("onboarding.finishAccountSetup")
                                  : agent.detail}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            <Button
              className={styles.onboardingAddProfile}
              size="sm"
              variant="ghost"
              disabled={Boolean(authBusy) || submitting || agentIds.length >= 16}
              onClick={addOvuleProfile}
            >
              <Plus size={14} />
              {t("onboarding.addOvuleProfile")}
            </Button>
            {agentIds.length === 0 && (
              <small className={styles.onboardingSelectionError}>
                {t("onboarding.selectAgent")}
              </small>
            )}
          </section>
        )}
        {connectionSetups.length > 0 && (
          <section className={styles.onboardingSection}>
            <h2>{t("hosts.connectionSetup")}</h2>
            <p>{t("hosts.connectionSetupDescription")}</p>
            {connectionSetups.map((setup) => renderExtensionSetup(setup))}
          </section>
        )}
        {error && (
          <div className={styles.onboardingError} role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className={cn(styles.onboardingSection, styles.onboardingFooter)}>
        {canCleanLegacyState && (
          <Button
            variant="ghost"
            disabled={loading || submitting || Boolean(authBusy)}
            onClick={() => void cleanLegacyState()}
          >
            <Trash2 size={14} />
            {t("onboarding.cleanLegacyState")}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={loading || submitting || Boolean(authBusy)}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? "spin" : undefined} size={14} />
          {t("onboarding.refresh")}
        </Button>
        <Button
          disabled={!allModelsReady || loading || submitting || Boolean(authBusy)}
          onClick={() => void complete()}
        >
          {submitting && <LoaderCircle className="spin" size={14} />}
          {t(submitting ? "onboarding.saving" : "onboarding.continue")}
        </Button>
      </footer>
    </div>
  );
  return (
    <section className={cn("onboarding-page-surface", styles.onboardingPage)}>{content}</section>
  );
}

export const OnboardingPageFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { workspace };
  return function OnboardingPage(props: Props) {
    return createElement(OnboardingPageContent, { dependencies, props });
  };
}, "OnboardingPage");

export const OnboardingPage = (...args: Parameters<ServiceOf<typeof OnboardingPageFactory>>) =>
  createElement(useService(OnboardingPageFactory), ...args);
