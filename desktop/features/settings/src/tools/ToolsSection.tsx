import shellTokens from "@ovule/shell/shell.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";

import { Input, Textarea } from "@ovule/ui/form";
import { FolderOpen, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ovule/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ovule/ui/tabs";
import { useService } from "@ovule/ioc/react";

import { cn } from "@ovule/ui/cn";
import styles from "@ovule/ui/SettingsSection.module.css";
import {
  CatalogSection,
  CatalogForm,
  Field,
  Check,
  FormActions,
  CardList,
} from "@ovule/ui/SettingsSection";
import type { SettingsSectionProps as Props } from "@ovule/settings/settings/settings";
type ToolsSectionDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
};

function ToolsSectionContent({
  dependencies,
  props,
}: {
  dependencies: ToolsSectionDependencies;
  props: Props;
}) {
  const i18n = useTranslation().i18n;

  const { shell } = dependencies;
  const { snapshot, busy, invoke } = props;

  const { t } = useTranslation();
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [transport, setTransport] = useState("http");
  const [target, setTarget] = useState("");
  const [args, setArgs] = useState("");
  const [credentialEnv, setCredentialEnv] = useState("");
  const [required, setRequired] = useState(false);
  const capabilityGroups = [
    ["built_in", t("catalog.builtInCapabilities")],
    ["extension", t("catalog.extensionCapabilities")],
    ["external_mcp", t("catalog.externalMcpCapabilities")],
  ] as const;
  const save = async () => {
    await invoke((api) =>
      api.upsertTool({
        id,
        label,
        transport,
        target,
        args: splitArgs(args),
        enabled: true,
        required,
        credentialEnv: credentialEnv || undefined,
      }),
    );
    setId("");
    setLabel("");
    setTarget("");
    setArgs("");
    setCredentialEnv("");
  };
  const chooseExecutable = async () => {
    const selected = await (
      await shell.dialog()
    ).openFile({
      title: t("catalog.chooseExecutable"),
      defaultPath: target || undefined,
    });
    if (selected) setTarget(selected);
  };
  return (
    <CatalogSection title={t("catalog.capabilityRegistry")} note={t("catalog.capabilityNote")}>
      {snapshot.legacyDataIssues.map((issue) => (
        <div className={styles.legacyWarning} role="alert" key={issue.id}>
          <ShieldAlert size={18} />
          <div className={styles.legacyWarningCopy}>
            <strong>{issue.title}</strong>
            <span className={styles.legacyWarningText}>{issue.detail}</span>
            <code className={styles.legacyWarningId}>{issue.affectedIds.join(", ")}</code>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void invoke((api) => api.cleanLegacyData())}
          >
            {t("catalog.cleanLegacyData")}
          </Button>
        </div>
      ))}
      <Tabs className={styles.toolsTabs} defaultValue="built_in">
        <TabsList className={styles.toolsTabsList}>
          {capabilityGroups.map(([source, label]) => (
            <TabsTrigger key={source} value={source}>
              {label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="manual">{t("catalog.addExternalMcp")}</TabsTrigger>
        </TabsList>
        {capabilityGroups.map(([source, label]) => {
          const capabilities = snapshot.capabilities.filter(
            (capability) => capability.source === source,
          );
          return (
            <TabsContent key={source} value={source} className={styles.toolsTabContent}>
              <section className={styles.capabilityGroup} data-capability-group={source}>
                <div className={styles.capabilityGroupHeader}>
                  <h4 className={styles.capabilityGroupTitle}>{label}</h4>
                  <span className={styles.capabilityGroupCount}>{capabilities.length}</span>
                </div>
                {capabilities.length ? (
                  <CardList>
                    {capabilities.map((capability) => {
                      const externalTool =
                        source === "external_mcp"
                          ? snapshot.tools.find(
                              (tool) => !tool.extensionId && capability.id === `mcp:${tool.id}`,
                            )
                          : undefined;
                      return (
                        <article
                          className={cn("catalog-card", styles.catalogCard)}
                          key={capability.id}
                        >
                          <div className={styles.catalogCardTitle}>
                            <span
                              className={cn(
                                styles.health,
                                capability.health === "ready" && styles.ok,
                                capability.health === "cleanup_required" && styles.warning,
                              )}
                            />
                            <strong>{capability.label}</strong>
                            <span className={styles.capabilityHealth}>{capability.health}</span>
                          </div>
                          <code className={styles.catalogCardMeta}>
                            {capability.backend} · {capability.provider} · {capability.kind}
                          </code>
                          <p className={styles.catalogCardDetail}>{capability.detail}</p>
                          <div className={styles.capabilityTags}>
                            {capability.operations.map((operation) => (
                              <span className={styles.capabilityTag} key={operation}>
                                {operation}
                              </span>
                            ))}
                          </div>
                          <small className={styles.catalogCardFootnote}>
                            {t("catalog.projections")}: {capability.projections.join(" · ")}
                          </small>
                          {capability.scopes.length > 0 && (
                            <small className={styles.catalogCardFootnote}>
                              {t("catalog.scopes")}: {capability.scopes.join(" · ")}
                            </small>
                          )}
                          {capability.agentExposures.length > 0 && (
                            <div className={styles.capabilityExposures}>
                              {capability.agentExposures.map((exposure) => (
                                <span
                                  key={`${exposure.agentId}:${exposure.projection}`}
                                  className={cn(
                                    styles.capabilityExposure,
                                    exposure.available && styles.exposureReady,
                                  )}
                                  title={exposure.detail}
                                >
                                  {exposure.agentId} · {exposure.projection}
                                </span>
                              ))}
                            </div>
                          )}
                          {externalTool && (
                            <div className={styles.catalogCardActions}>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void invoke((api) =>
                                    api.upsertTool({
                                      id: externalTool.id,
                                      label: externalTool.label,
                                      transport: externalTool.transport,
                                      target: externalTool.target,
                                      args: externalTool.args,
                                      enabled: !externalTool.enabled,
                                      required: externalTool.required,
                                      credentialEnv: externalTool.credentialEnv,
                                    }),
                                  )
                                }
                              >
                                {externalTool.enabled ? t("catalog.disable") : t("catalog.enable")}
                              </Button>
                              <Button
                                size="icon"
                                variant="danger"
                                aria-label={t("catalog.remove", {
                                  title: externalTool.label,
                                })}
                                onClick={() =>
                                  void invoke((api) => api.removeTool(externalTool.id))
                                }
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </CardList>
                ) : (
                  <p className={styles.capabilityEmpty}>{t("catalog.noCapabilities")}</p>
                )}
              </section>
            </TabsContent>
          );
        })}
        <TabsContent value="manual" className={styles.toolsTabContent}>
          <CatalogForm>
            <Field label={t("catalog.id")}>
              <Input
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="docs"
              />
            </Field>
            <Field label={t("catalog.label")}>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t("catalog.toolLabelPlaceholder")}
              />
            </Field>
            <Field label={t("catalog.transport")}>
              <Select value={transport} onValueChange={setTransport}>
                <SelectTrigger aria-label={t("catalog.transport")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http"> {i18n.t("tools.streamableHTTP")} </SelectItem>
                  <SelectItem value="stdio">stdio</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={transport === "http" ? t("catalog.url") : t("catalog.executable")}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder={transport === "http" ? "https://example.com/mcp" : "npx"}
                />
                {transport === "stdio" && (
                  <Button
                    aria-label={t("catalog.chooseExecutable")}
                    title={t("catalog.chooseExecutable")}
                    size="icon"
                    variant="ghost"
                    onClick={() => void chooseExecutable()}
                  >
                    <FolderOpen size={14} />
                  </Button>
                )}
              </div>
            </Field>
            {transport === "stdio" && (
              <Field label={t("catalog.arguments")} full>
                <Textarea
                  className={styles.catalogTextarea}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                />
              </Field>
            )}
            <Field label={t("catalog.credential")}>
              <Input
                value={credentialEnv}
                onChange={(event) => setCredentialEnv(event.target.value)}
                placeholder="MCP_ACCESS_TOKEN"
              />
            </Field>
            <Check label={t("catalog.required")} checked={required} onChange={setRequired} />
            <FormActions busy={busy} valid={Boolean(id && label && target)} save={save} />
          </CatalogForm>
        </TabsContent>
      </Tabs>
    </CatalogSection>
  );
}

export const ToolsSectionFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const dependencies = { shell };
  return function ToolsSection(props: Props) {
    return createElement(ToolsSectionContent, { dependencies, props });
  };
}, "ToolsSection");

export const ToolsSection = (...args: Parameters<ServiceOf<typeof ToolsSectionFactory>>) =>
  createElement(useService(ToolsSectionFactory), ...args);

function splitArgs(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
