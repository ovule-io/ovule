import type { SettingsStateController } from "@ovule/settings/settings/state";
import type { ToolsStateController } from "@ovule/settings/tools/state";
import type { SkillsStateController } from "@ovule/settings/skills/state";
import type { ModelsStateController } from "@ovule/settings/models/state";
import type { AgentsStateController } from "@ovule/settings/agents/state";
import type { HostsStateController } from "@ovule/hosts/state";
import type { WorkspaceStateController } from "@ovule/workspace/state";
import type { TerminalStateController } from "@ovule/terminal/state";
import type { WorkflowStateController } from "@ovule/workflow/state";
import type { ConversationStateController } from "@ovule/conversation/state";
import type { AppSnapshot } from "@ovule/shell-api";
import type { WorkspaceService } from "@ovule/workspace/workspace";
import type { SelectionService } from "@ovule/conversation/selection/selection";
import type { SnapshotSyncService } from "@ovule/shell/snapshot-sync";
export type DomainControllers = {
  conversation: ConversationStateController;
  workflow: WorkflowStateController;
  terminal: TerminalStateController;
  workspace: WorkspaceStateController;
  hosts: HostsStateController;
  agents: AgentsStateController;
  models: ModelsStateController;
  skills: SkillsStateController;
  tools: ToolsStateController;
  settings: SettingsStateController;
};

export function createDomainGraph(
  workspace: Pick<WorkspaceService, "api">,
  selection: SelectionService,
  stores: DomainControllers,
) {
  let revision: bigint | undefined;
  const apply = (snapshot: AppSnapshot, fallback: "first" | "last") => {
    if (revision !== undefined && snapshot.revision < revision) return;
    revision = snapshot.revision;
    stores.conversation.stage({
      ...stores.conversation.service.current(),
      snapshot: {
        revision: snapshot.revision,
        threads: snapshot.threads ?? [],
        messages: snapshot.messages ?? [],
      },
    });
    stores.workflow.stage({
      ...stores.workflow.service.current(),
      snapshot: {
        revision: snapshot.revision,
        goals: snapshot.goals ?? [],
        nodes: snapshot.nodes ?? [],
        attempts: snapshot.attempts ?? [],
      },
    });
    stores.terminal.stage({
      ...stores.terminal.service.current(),
      snapshot: { revision: snapshot.revision, terminalRuns: snapshot.terminalRuns ?? [] },
    });
    stores.workspace.stage({
      ...stores.workspace.service.current(),
      snapshot: {
        revision: snapshot.revision,
        projects: snapshot.projects ?? [],
        bindings: snapshot.bindings ?? [],
      },
    });
    stores.hosts.stage({
      ...stores.hosts.service.current(),
      snapshot: {
        revision: snapshot.revision,
        hosts: snapshot.hosts ?? [],
        endpoints: snapshot.endpoints ?? [],
      },
    });
    stores.agents.stage({
      ...stores.agents.service.current(),
      snapshot: { revision: snapshot.revision, agents: snapshot.agents ?? [] },
    });
    stores.models.stage({
      ...stores.models.service.current(),
      snapshot: { revision: snapshot.revision, models: snapshot.models ?? [] },
    });
    stores.skills.stage({
      ...stores.skills.service.current(),
      snapshot: { revision: snapshot.revision, skills: snapshot.skills ?? [] },
    });
    stores.tools.stage({
      ...stores.tools.service.current(),
      snapshot: { revision: snapshot.revision, tools: snapshot.tools ?? [] },
    });
    stores.settings.stage({
      ...stores.settings.service.current(),
      snapshot: {
        revision: snapshot.revision,
        capabilities: snapshot.capabilities ?? [],
        legacyDataIssues: snapshot.legacyDataIssues ?? [],
      },
    });

    // Every domain is staged before any subscriber or selection listener runs.
    selection.acceptSnapshot(snapshot, fallback);
    for (const store of Object.values(stores)) store.notify();
  };
  let loading: Promise<void> | undefined;
  let reloadRequested = false;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const sync: SnapshotSyncService = {
    load() {
      if (loading) {
        reloadRequested = true;
        return loading;
      }
      clearTimeout(reloadTimer);
      reloadRequested = false;
      // Thinking can invalidate the workspace for every token. Keep one
      // request in flight and one trailing refresh. Callers awaiting load
      // only wait for this snapshot, never for the entire streaming turn.
      loading = sync
        .invoke((api) => api.snapshot())
        .then(() => undefined)
        .finally(() => {
          loading = undefined;
          if (reloadRequested) reloadTimer = setTimeout(() => void sync.load(), 100);
        });
      return loading;
    },
    async invoke(operation) {
      // The shell compatibility operation is scoped to domains touched by its API calls.
      const affected = new Set<keyof typeof stores>();
      const touch = (domain: keyof typeof stores) => {
        if (affected.has(domain)) return;
        affected.add(domain);
        const store = stores[domain],
          state = store.service.current();
        store.patch({ pending: state.pending + 1, busy: true, error: undefined });
        store.notify();
      };
      let failure: string | undefined;
      try {
        const api = await workspace.api();
        const scoped = new Proxy(api, {
          get(target, key) {
            const method = Reflect.get(target, key);
            if (typeof method !== "function") return method;
            return (...args: unknown[]) => {
              if (key !== "snapshot" || !affected.size) touch(commandDomain(String(key)));
              return Reflect.apply(method, target, args);
            };
          },
        });
        apply(await operation(scoped), "first");
        return true;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        if (!affected.size) touch("workspace");
        return false;
      } finally {
        for (const domain of affected) {
          const store = stores[domain],
            state = store.service.current();
          const pending = Math.max(0, state.pending - 1);
          store.patch({ pending, busy: pending > 0, error: failure });
        }
        for (const domain of affected) stores[domain].notify();
      }
    },
    acceptSnapshot(snapshot) {
      apply(snapshot, "last");
    },
    appendAgentOutput(event) {
      const workflow = stores.workflow.service.current(),
        conversation = stores.conversation.service.current();
      if (!workflow.snapshot || !conversation.snapshot) return;
      const attemptIndex = workflow.snapshot.attempts.findIndex(
        (attempt) => attempt.id === event.attemptId,
      );
      if (attemptIndex < 0) {
        void sync.load();
        return;
      }
      const attempt = workflow.snapshot.attempts[attemptIndex],
        sequence = BigInt(event.sequence);
      if (sequence < attempt.outputSequence) return;
      if (sequence > attempt.outputSequence) {
        void sync.load();
        return;
      }
      if (revision !== undefined && BigInt(event.revision) < revision) return;
      revision = BigInt(event.revision);
      const attempts = workflow.snapshot.attempts.slice();
      attempts[attemptIndex] = {
        ...attempt,
        output: attempt.output + event.delta,
        outputSequence: attempt.outputSequence + 1n,
      };
      const messages = conversation.snapshot.messages.map((message) => {
        if (
          message.attemptId !== event.attemptId ||
          message.role !== "assistant" ||
          message.status !== "streaming"
        )
          return message;
        const content = message.content + event.delta;
        return {
          ...message,
          content,
          streamSequence: message.streamSequence + 1n,
          parts: message.parts.map((part, index) =>
            part.kind === "markdown" && index === 0 ? { ...part, text: content } : part,
          ),
        };
      });
      stores.workflow.stage({
        ...workflow,
        snapshot: { ...workflow.snapshot, revision, attempts },
      });
      stores.conversation.stage({
        ...conversation,
        snapshot: { ...conversation.snapshot, revision, messages },
      });
      stores.workflow.notify();
      stores.conversation.notify();
    },
  };
  return { stores, sync };
}
function commandDomain(
  method: string,
):
  | "conversation"
  | "workflow"
  | "terminal"
  | "workspace"
  | "hosts"
  | "agents"
  | "models"
  | "skills"
  | "tools"
  | "settings" {
  if (/^(?:selectAgent|selectHost|setThreadWorkspace|setThreadWorkspaceBindings)$/.test(method))
    return "conversation";
  if (/terminal/i.test(method)) return "terminal";
  if (/goal|task|gate|workflow/i.test(method)) return "workflow";
  if (/remoteHost|localHost|LinkHost|Device|Endpoint|Pairing|Host/i.test(method)) return "hosts";
  if (/agent/i.test(method)) return "agents";
  if (/model|ollama/i.test(method)) return "models";
  if (/skill/i.test(method)) return "skills";
  if (/tool/i.test(method)) return "tools";
  if (/thread|message|attachment/i.test(method)) return "conversation";
  if (/project|workspace|binding|snapshot/i.test(method)) return "workspace";
  return "settings";
}
