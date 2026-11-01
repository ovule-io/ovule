import workspaceTokens from "@ovule/workspace/workspace.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { Download, HardDrive, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ovule/ui/dialog";

import type { OllamaModelJobView, OnboardingStatus } from "@ovule/shell-api";
import { useService } from "@ovule/ioc/react";

type Props = {
  status?: OnboardingStatus;
  onRefresh?(): Promise<void>;
  onError?(message: string): void;
};

type OllamaSetupCardDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function OllamaSetupCardContent({
  dependencies,
  props,
}: {
  dependencies: OllamaSetupCardDependencies;
  props: Props;
}) {
  const { workspace } = dependencies;
  const { status, onRefresh, onError } = props;

  const { t } = useTranslation();
  const [model, setModel] = useState("qwen3:4b");
  const [job, setJob] = useState<OllamaModelJobView>();
  const [localStatus, setLocalStatus] = useState<OnboardingStatus>();
  const [localError, setLocalError] = useState<string>();
  const [installing, setInstalling] = useState(false);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const effectiveStatus = status ?? localStatus;
  const reportError = useCallback(
    (message: string) => (onError ? onError(message) : setLocalError(message)),
    [onError],
  );
  const refresh = useCallback(async () => {
    if (onRefresh) {
      await onRefresh();
    } else {
      setLocalStatus(await (await workspace.api()).onboardingStatus());
    }
  }, [onRefresh, workspace]);
  const toolchain = effectiveStatus?.toolchains.find((item) => item.id === "ollama");
  const installedModels = useMemo(
    () =>
      effectiveStatus?.models.filter((item) => item.provider === "ollama" && item.available) ?? [],
    [effectiveStatus],
  );

  useEffect(() => {
    void workspace
      .api()
      .then((api) => api.ollamaModelJobs())
      .then((jobs) => setJob(jobs.find((item) => item.status === "pulling") ?? jobs.at(-1)))
      .catch(() => undefined);
    return workspace.observeOllamaModelChanged((event) => {
      setJob(event);
      if (event.status === "failed") reportError(event.error ?? event.detail);
      if (event.status === "succeeded") void refresh();
    });
  }, [refresh, reportError, workspace]);

  useEffect(() => {
    if (!status) void refresh().catch((cause) => reportError(String(cause)));
  }, [refresh, reportError, status]);

  useEffect(
    () =>
      workspace.observeToolchainChanged((event) => {
        if (event.id !== "ollama") return;
        setInstalling(event.status === "installing");
        if (event.status === "failed")
          reportError(event.error ?? t("catalog.installToolchainFailed"));
        if (event.status !== "installing") void refresh();
      }),
    [refresh, reportError, t, workspace],
  );

  const install = async () => {
    setConfirmInstall(false);
    setInstalling(true);
    try {
      const items = await (await workspace.api()).installToolchain("ollama");
      const ollama = items.find((item) => item.id === "ollama");
      if (ollama?.installStatus === "failed") {
        reportError(ollama.installError ?? t("catalog.installToolchainFailed"));
        setInstalling(false);
      }
    } catch (cause) {
      setInstalling(false);
      reportError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const pull = async () => {
    try {
      setJob(await (await workspace.api()).pullOllamaModel(model.trim()));
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const pulling = job?.status === "pulling";
  return (
    <div className="integration-card ollama-setup-card" data-testid="ollama-setup">
      <div>
        <HardDrive />
        <span>
          <strong>Ollama</strong>
          <small>
            {toolchain?.detail ?? t("onboarding.ollamaMissing")}
            {installedModels.length > 0
              ? ` · ${t("onboarding.ollamaModelsFound", { count: installedModels.length })}`
              : ""}
          </small>
        </span>
      </div>
      {!toolchain?.available && toolchain?.installable ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={installing}
          onClick={() => setConfirmInstall(true)}
        >
          {installing && <LoaderCircle className="spin" size={14} />}
          {installing ? t("onboarding.installingOllama") : t("onboarding.installOllama")}
        </Button>
      ) : toolchain?.available ? (
        <div className="ollama-pull">
          <Input
            value={model}
            disabled={pulling}
            aria-label={t("onboarding.ollamaModel")}
            onChange={(event) => setModel(event.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!model.trim() || pulling}
            onClick={() => void pull()}
          >
            {pulling ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
            {pulling ? t("onboarding.pullingModel") : t("onboarding.pullModel")}
          </Button>
          {job && (
            <small className={job.status === "failed" ? "error" : ""}>
              {job.error ?? job.detail}
            </small>
          )}
        </div>
      ) : null}
      <Dialog open={confirmInstall} onOpenChange={setConfirmInstall}>
        <DialogContent className="toolchain-confirm-dialog">
          <DialogHeader>
            <DialogTitle>{t("catalog.installToolchainTitle")}</DialogTitle>
            <DialogDescription>{t("onboarding.installOllamaConfirm")}</DialogDescription>
          </DialogHeader>
          <div className="toolchain-confirm-detail">
            <strong>Ollama {toolchain?.requestedVersion}</strong>
            <p>{t("onboarding.installOllamaSize")}</p>
            <p>{t("catalog.installToolchainIsolation")}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmInstall(false)}>
              {t("catalog.cancel")}
            </Button>
            <Button onClick={() => void install()}>{t("catalog.installToolchain")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {localError && <small className="error">{localError}</small>}
    </div>
  );
}

export const OllamaSetupCardFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { workspace };
  return function OllamaSetupCard(props: Props) {
    return createElement(OllamaSetupCardContent, { dependencies, props });
  };
}, "OllamaSetupCard");

export const OllamaSetupCard = (...args: Parameters<ServiceOf<typeof OllamaSetupCardFactory>>) =>
  createElement(useService(OllamaSetupCardFactory), ...args);
