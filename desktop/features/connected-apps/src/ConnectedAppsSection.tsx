import workspaceTokens from "@ovule/workspace/workspace.token";
import type { ViewData } from "./view-data";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Button } from "@ovule/ui/button";
import { Checkbox, Input } from "@ovule/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ovule/ui/select";
import { useService } from "@ovule/ioc/react";
import { ChevronRight, ExternalLink, Plug, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WorkspaceOperation } from "./operations";

import {
  connectedApps,
  connectedAppProviders,
  connectedAppNameError,
  connectedAppToolId,
  connectionEndpointError,
  credentialEnvironmentError,
} from "./connection-model";
import type { ConnectedAppId, ConnectedAppProviderId } from "./connection-model";

type ConnectedAppsSectionDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function ConnectedAppsSectionContent({
  dependencies,
  props,
}: {
  dependencies: ConnectedAppsSectionDependencies;
  props: {
    snapshot: ViewData;
    busy: boolean;
    invoke(operation: WorkspaceOperation): Promise<boolean>;
  };
}) {
  const { workspace } = dependencies;
  const { snapshot, busy, invoke } = props;

  const { t } = useTranslation();
  const [providerId, setProviderId] = useState<ConnectedAppProviderId>("activepieces");
  const [appId, setAppId] = useState<ConnectedAppId>("gmail");
  const [customAppName, setCustomAppName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [credentialEnv, setCredentialEnv] = useState("ACTIVEPIECES_ACCESS_TOKEN");
  const [agentIds, setAgentIds] = useState(() =>
    snapshot.agents.filter((agent) => agent.enabled).map((agent) => agent.id),
  );
  const [submitted, setSubmitted] = useState(false);
  const provider = connectedAppProviders.find((item) => item.id === providerId)!;
  const app = connectedApps.find((item) => item.id === appId)!;
  const appName = appId === "custom" ? customAppName.trim() : app.label;
  const appNameError = connectedAppNameError(appName);
  const endpointError = endpoint ? connectionEndpointError(endpoint) : undefined;
  const credentialError = credentialEnvironmentError(credentialEnv);
  const connections = useMemo(
    () => snapshot.tools.filter((tool) => tool.transport === "http" && tool.id.startsWith("app-")),
    [snapshot.tools],
  );

  const selectProvider = (value: string) => {
    const next = connectedAppProviders.find((item) => item.id === value);
    if (!next) return;
    setProviderId(next.id);
    setCredentialEnv(next.credentialPlaceholder);
    setSubmitted(false);
  };
  const connect = async () => {
    setSubmitted(true);
    if (
      !endpoint ||
      appNameError ||
      agentIds.length === 0 ||
      connectionEndpointError(endpoint) ||
      credentialEnvironmentError(credentialEnv)
    ) {
      return;
    }
    const id = connectedAppToolId(providerId, appName, endpoint);
    const changed = await invoke(async (api) => {
      let next = await api.upsertTool({
        id,
        label: `${appName} · ${provider.label}`,
        transport: "http",
        target: endpoint.trim(),
        args: [],
        enabled: true,
        required: false,
        credentialEnv: credentialEnv.trim() || undefined,
      });
      for (const agent of snapshot.agents.filter((candidate) => agentIds.includes(candidate.id))) {
        next = await api.upsertAgent({
          id: agent.id,
          label: agent.label,
          driver: agent.driver,
          modelId: agent.modelId,
          skillIds: agent.skillIds,
          toolIds: [...new Set([...agent.toolIds, id])],
          instructions: agent.instructions,
          enabled: agent.enabled,
        });
      }
      return next;
    });
    if (changed) {
      setEndpoint("");
      if (appId === "custom") setCustomAppName("");
      setSubmitted(false);
    }
  };

  const removeConnection = async (connectionId: string) => {
    await invoke(async (api) => {
      for (const agent of snapshot.agents.filter((candidate) =>
        candidate.toolIds.includes(connectionId),
      )) {
        await api.upsertAgent({
          id: agent.id,
          label: agent.label,
          driver: agent.driver,
          modelId: agent.modelId,
          skillIds: agent.skillIds,
          toolIds: agent.toolIds.filter((id) => id !== connectionId),
          instructions: agent.instructions,
          enabled: agent.enabled,
        });
      }
      return api.removeTool(connectionId);
    });
  };

  return (
    <section className="grid gap-4" data-connected-apps>
      <div className="grid gap-3 rounded-xl border border-(--line) bg-(--surface) p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--primary) text-xs font-semibold text-(--primary-foreground)">
            1
          </span>
          <div className="min-w-0 flex-1">
            <strong className="text-(length:--font-size-ui) font-medium">
              {t("connections.accountStep")}
            </strong>
            <p className="mt-1 mb-0 text-(length:--font-size-ui) leading-5 text-(--muted-foreground)">
              {t("connections.accountStepHint")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-md:grid-cols-1">
          <Select value={appId} onValueChange={(value) => setAppId(value as ConnectedAppId)}>
            <SelectTrigger aria-label={t("connections.app")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connectedApps.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => workspace.requestBrowserUse(provider.docsUrl)}>
            <ExternalLink size={14} /> {t("connections.setupAccount")}
          </Button>
          {appId === "custom" && (
            <Input
              className="col-span-full"
              value={customAppName}
              onChange={(event) => {
                setCustomAppName(event.target.value);
                setSubmitted(false);
              }}
              aria-invalid={submitted && Boolean(appNameError)}
              placeholder={t("connections.appNamePlaceholder")}
            />
          )}
        </div>
        <p className="m-0 rounded-lg bg-(--surface-2) px-3 py-2 text-(length:--font-size-caption) leading-5 text-(--muted-foreground)">
          {t("connections.oauthUnavailable")}
        </p>
      </div>

      <div className="grid gap-2 rounded-xl border border-(--line) bg-(--surface) p-3 text-(length:--font-size-ui)">
        <strong className="inline-flex items-center gap-2 font-medium">
          <Sparkles size={15} /> {t("connections.howToTrigger")}
        </strong>
        <p className="m-0 leading-6 text-(--muted-foreground)">{t("connections.triggerHint")}</p>
      </div>

      <details className="group overflow-hidden rounded-xl border border-(--line) bg-(--surface-2)">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-(length:--font-size-ui)">
          <span className="inline-flex items-center gap-2 font-medium">
            <ChevronRight className="transition-transform group-open:rotate-90" size={15} />
            {t("connections.advancedMcp")}
          </span>
          <small className="text-(length:--font-size-caption) text-(--muted-foreground)">
            {t("connections.advancedMcpHint")}
          </small>
        </summary>
        <div className="grid grid-cols-2 gap-3 border-t border-(--line) p-4 max-md:grid-cols-1">
          <label className="grid gap-1.5 text-(length:--font-size-ui) text-(--muted-foreground)">
            {t("connections.provider")}
            <Select value={providerId} onValueChange={selectProvider}>
              <SelectTrigger aria-label={t("connections.provider")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connectedAppProviders.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-(length:--font-size-ui) text-(--muted-foreground)">
            {t("connections.credentialEnv")}
            <Input
              value={credentialEnv}
              onChange={(event) => setCredentialEnv(event.target.value)}
              aria-invalid={submitted && Boolean(credentialError)}
              placeholder={provider.credentialPlaceholder}
            />
          </label>
          <label className="col-span-full grid gap-1.5 text-(length:--font-size-ui) text-(--muted-foreground)">
            {t("connections.endpoint")}
            <Input
              aria-label={t("connections.endpoint")}
              value={endpoint}
              onChange={(event) => {
                setEndpoint(event.target.value);
                setSubmitted(false);
              }}
              aria-invalid={submitted && Boolean(endpointError)}
              placeholder={provider.endpointPlaceholder}
            />
            <small className="text-(length:--font-size-caption) leading-5 text-(--faint)">
              {t("connections.endpointHelp")}
            </small>
          </label>
          <fieldset className="col-span-full grid gap-2 rounded-lg border border-(--line) p-3">
            <legend className="px-1 text-(length:--font-size-ui) text-(--muted-foreground)">
              {t("connections.availableToAgents")}
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {snapshot.agents.map((agent) => (
                <label
                  key={agent.id}
                  className="inline-flex items-center gap-2 text-(length:--font-size-ui) text-(--foreground)"
                >
                  <Checkbox
                    checked={agentIds.includes(agent.id)}
                    disabled={!agent.enabled}
                    onChange={(event) =>
                      setAgentIds((current) =>
                        event.target.checked
                          ? [...new Set([...current, agent.id])]
                          : current.filter((id) => id !== agent.id),
                      )
                    }
                  />
                  {agent.label}
                </label>
              ))}
            </div>
            <small className="text-(length:--font-size-caption) text-(--faint)">
              {t("connections.agentHint")}
            </small>
          </fieldset>
          {submitted && (appNameError || endpointError || credentialError || !agentIds.length) && (
            <p
              className="col-span-full m-0 text-(length:--font-size-caption) text-(--danger)"
              role="alert"
            >
              {t(appNameError ?? endpointError ?? credentialError ?? "connections.selectAgent")}
            </p>
          )}
          <div className="col-span-full flex items-center justify-between gap-3">
            <p className="m-0 text-(length:--font-size-caption) text-(--faint)">
              {t("connections.secretHint")}
            </p>
            <Button disabled={busy || !endpoint} onClick={() => void connect()}>
              <Plug size={14} /> {t("connections.connect", { app: appName || app.label })}
            </Button>
          </div>
        </div>
      </details>

      <div className="grid gap-2">
        {connections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-(--line) px-3 py-6 text-center text-(length:--font-size-ui) text-(--muted-foreground)">
            {t("connections.empty")}
          </div>
        ) : (
          connections.map((connection) => (
            <article
              key={connection.id}
              className="flex items-center gap-3 rounded-lg border border-(--line) bg-(--surface) px-3 py-2.5"
            >
              <span
                className="size-2 shrink-0 rounded-full bg-(--success) data-[healthy=false]:bg-(--warning)"
                data-healthy={connection.available}
              />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-(length:--font-size-ui) font-medium text-(--foreground)">
                  {connection.label}
                </strong>
                <small className="block truncate text-(length:--font-size-caption) text-(--muted-foreground)">
                  {connection.detail} · {connection.target}
                </small>
                <small className="block truncate text-(length:--font-size-caption) text-(--faint)">
                  {t("connections.enabledFor", {
                    agents:
                      snapshot.agents
                        .filter((agent) => agent.toolIds.includes(connection.id))
                        .map((agent) => agent.label)
                        .join(", ") || t("connections.noAgents"),
                  })}
                </small>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("connections.remove", {
                  label: connection.label,
                })}
                onClick={() => void removeConnection(connection.id)}
              >
                <Trash2 size={14} />
              </Button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

export const ConnectedAppsSectionFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { workspace };
  return function ConnectedAppsSection(props: {
    snapshot: ViewData;
    busy: boolean;
    invoke(operation: WorkspaceOperation): Promise<boolean>;
  }) {
    return createElement(ConnectedAppsSectionContent, { dependencies, props });
  };
}, "ConnectedAppsSection");

export const ConnectedAppsSection = (
  ...args: Parameters<ServiceOf<typeof ConnectedAppsSectionFactory>>
) => useService(ConnectedAppsSectionFactory)(...args);
