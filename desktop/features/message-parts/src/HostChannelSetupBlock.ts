import type { i18n as I18n } from "i18next";
type ChannelConnection = {
  connectionId?: string;
  boundThreadId?: string;
  botName?: string;
  appIdHint?: string;
  state?: string;
  detail?: string;
  configured?: boolean;
  provisioned?: boolean;
  connected?: boolean;
  ownerPaired?: boolean;
  pairingCode?: string;
  lastMessageAtMs?: number;
  lastAgentAttemptAtMs?: number;
  lastDeliveryAtMs?: number;
};

type ChannelSetupData = {
  selectedConnectionId?: string;
  connections?: ChannelConnection[];
  threads?: { id: string; title: string }[];
};

type ExtensionActionResult = CustomEvent<{
  action?: string;
  data?: ChannelSetupData;
  error?: string;
  pending?: boolean;
}>;

function channelBlock(i18n: I18n) {
  const localized = (key: string) => escapeText(i18n.t(key));
  return class HostChannelSetupBlock extends HTMLElement {
    #data: ChannelSetupData = {};
    #liveData = false;
    #pollTimer?: ReturnType<typeof setTimeout>;
    #busy = false;
    #actionError = "";
    #activeAction = "";
    #feedback = "";
    #adding = false;
    #connectionDraft = "";
    #connectionError = "";
    #bindingError = "";

    readonly #languageChanged = () => this.#render();

    connectedCallback() {
      i18n.on("languageChanged", this.#languageChanged);
      this.addEventListener(
        "ovule:extension-action-result",
        this.#handleActionResult as EventListener,
      );
      this.#render();
      // Persisted message parts are snapshots; reload the current destination on mount.
      queueMicrotask(() => {
        if (this.isConnected) this.#run("status");
      });
    }

    disconnectedCallback() {
      clearTimeout(this.#pollTimer);
      i18n.off("languageChanged", this.#languageChanged);
      this.removeEventListener(
        "ovule:extension-action-result",
        this.#handleActionResult as EventListener,
      );
    }

    set data(value: unknown) {
      // Agent message parts are historical snapshots. Once refreshed, they must
      // not overwrite authoritative connection state as the message streams.
      if (this.#liveData) return;
      this.#data = value && typeof value === "object" ? (value as ChannelSetupData) : {};
      this.#render();
    }

    set threads(value: { id: string; title: string }[]) {
      this.#data = { ...this.#data, threads: value };
      this.#render();
    }

    set streaming(_value: boolean) {}

    readonly #handleActionResult = (event: ExtensionActionResult) => {
      const detail = event.detail ?? {};
      if (!["refresh", "status", "connect-existing", "bind-thread"].includes(detail.action ?? ""))
        return;
      this.#busy = detail.pending === true;
      if (detail.action === "refresh" && !detail.pending && !detail.error) {
        this.#feedback = i18n.t("messageList.connectionStatusUpdated");
      }
      if (detail.data) {
        this.#liveData = true;
        this.#data = { ...this.#data, ...detail.data };
      }
      this.#actionError =
        detail.error && detail.action !== "bind-thread" ? String(detail.error) : "";
      if (detail.error && detail.action === "bind-thread") {
        this.#bindingError = String(detail.error);
      } else if (detail.error) {
        const selectedConnectionId = this.#selectedConnectionId();
        const connections = this.#connections().map((connection) =>
          connection.connectionId === selectedConnectionId
            ? { ...connection, state: "error", detail: String(detail.error) }
            : connection,
        );
        this.#data = { ...this.#data, connections };
      }
      this.#render();
      clearTimeout(this.#pollTimer);
      const selected = this.#connections().find(
        (item) => item.connectionId === this.#selectedConnectionId(),
      );
      if (
        !this.#busy &&
        !detail.error &&
        selected &&
        selected.state !== "error" &&
        ([
          "registering",
          "refreshing",
          "waiting_for_authorization",
          "provisioning",
          "starting",
          "connecting",
        ].includes(selected.state ?? "") ||
          (selected.configured && !selected.lastDeliveryAtMs))
      ) {
        this.#pollTimer = setTimeout(() => {
          if (this.isConnected) this.#run("status");
        }, 2000);
      }
    };

    #run(action: string, connectionId = this.#selectedConnectionId(), threadId?: string) {
      if (this.#busy) return;
      clearTimeout(this.#pollTimer);
      this.#busy = true;
      this.#activeAction = action;
      this.#actionError = "";
      if (action !== "status") this.#feedback = "";
      this.#bindingError = "";
      this.#render();
      this.dispatchEvent(
        new CustomEvent("ovule:extension-action", {
          bubbles: true,
          composed: true,
          detail: { action, connectionId, threadId },
        }),
      );
    }

    #connections(): ChannelConnection[] {
      return Array.isArray(this.#data.connections) ? this.#data.connections : [];
    }

    #selectedConnectionId(): string {
      const selected = this.#data.selectedConnectionId;
      return this.#connections().some((item) => item.connectionId === selected)
        ? selected!
        : (this.#connections()[0]?.connectionId ?? "default");
    }

    #nextConnectionId(): string {
      const ids = new Set(this.#connections().map((item) => item.connectionId));
      let suffix = 2;
      while (ids.has(`channel-${suffix}`)) suffix += 1;
      return `channel-${suffix}`;
    }

    #render() {
      if (!this.isConnected) return;
      const connections = this.#connections();
      const selectedId = this.#selectedConnectionId();
      const selected = connections.find((item) => item.connectionId === selectedId) ?? {};
      const actionError = this.#actionError || (selected.state === "error" ? selected.detail : "");
      const state = escapeText(selected.state ?? "not_configured");
      const stateLabel = escapeText(
        i18n.t(`messageList.connectionStates.${selected.state ?? "not_configured"}`, {
          defaultValue: selected.state ?? "",
        }),
      );
      const detail = escapeText(
        selected.detail ?? i18n.t("messageList.addAConnectionOrInspectAnExistingBot"),
      );
      const stages = [
        [i18n.t("messageList.authorization"), selected.configured === true],
        [i18n.t("messageList.appEvents"), selected.provisioned === true],
        [i18n.t("messageList.webSocket"), selected.connected === true],
        [i18n.t("messageList.owner"), selected.ownerPaired === true],
        [i18n.t("messageList.inbound"), Boolean(selected.lastMessageAtMs)],
        [i18n.t("onboarding.agent"), Boolean(selected.lastAgentAttemptAtMs)],
        [i18n.t("messageList.reply"), Boolean(selected.lastDeliveryAtMs)],
      ]
        .map(
          ([label, ready]) =>
            `<span class="stage ${ready ? "ready" : "pending"}"><i></i>${escapeText(label)}</span>`,
        )
        .join("");
      const options = connections.length
        ? connections
            .map((item) => {
              const id = escapeText(item.connectionId ?? "");
              const label = escapeText(
                [item.botName, item.appIdHint, item.connectionId].find(
                  (value) => typeof value === "string" && value.trim(),
                ) ?? i18n.t("messageList.bot"),
              );
              return `<option value="${id}" ${item.connectionId === selectedId ? "selected" : ""}>${label}</option>`;
            })
            .join("")
        : `<option value="default">${localized("messageList.noBotConfigured")}</option>`;
      const threads = Array.isArray(this.#data.threads) ? this.#data.threads : [];
      const targetOptions =
        `<option value="">${localized("messageList.channelThreadAutomatic")}</option>` +
        threads
          .map(
            (thread) =>
              `<option value="${escapeText(thread.id)}" ${thread.id === selected.boundThreadId ? "selected" : ""}>${escapeText(thread.title)}</option>`,
          )
          .join("");
      const binding = selected.configured
        ? `<label class="connection"><span>${localized("messageList.channelThreadTarget")}</span><select name="thread-target" ${this.#busy || !selected.configured ? "disabled" : ""}>${targetOptions}</select></label><small>${localized("messageList.channelThreadHint")}</small>`
        : "";
      const connectionForm = this.#adding
        ? `<form class="add-connection">
          <label><span>${localized("messageList.newConnectionId")}</span><input name="connection-id" maxlength="64" autocomplete="off" spellcheck="false" value="${escapeText(this.#connectionDraft)}" aria-invalid="${this.#connectionError ? "true" : "false"}"></label>
          ${this.#connectionError ? `<span class="error" role="alert">${escapeText(this.#connectionError)}</span>` : ""}
          <div class="actions"><button type="submit">${localized("messageList.connectBot")}</button><button type="button" data-action="cancel-add">${localized("messageList.cancel")}</button></div>
        </form>`
        : "";
      const pairing =
        selected.connected && !selected.ownerPaired && selected.pairingCode
          ? `<div class="pair"><span>${localized("messageList.privateChatPairing")}</span><code>/pair ${escapeText(selected.pairingCode)}</code></div>`
          : "";
      const verified = selected.ownerPaired
        ? `<div class="verified">Owner paired${selected.lastDeliveryAtMs ? i18n.t("messageList.realReplyDelivered") : i18n.t("messageList.sendARealTestMessage")}</div>`
        : "";
      this.innerHTML = `<style>${styles}</style>
      <section aria-busy="${this.#busy}">
        <header><strong>${localized("messageList.channelVerification")}</strong><span data-state="${state}">${stateLabel}</span></header>
        ${connections.some((connection) => connection.configured) ? `<label class="connection"><span>${localized("messageList.botConnection")}</span><select name="bot-connection" ${this.#busy ? "disabled" : ""}>${options}</select></label>` : ""}
        <div class="stages" aria-label="${localized("messageList.channelVerification")}">${stages}</div>
        ${actionError === selected.detail ? "" : `<p>${detail}</p>`}${pairing}${verified}
        ${this.#busy && this.#activeAction !== "status" ? `<p role="status">${localized(this.#activeAction === "connect-existing" ? "messageList.connectingBot" : "messageList.refreshingBot")}</p>` : ""}
        ${this.#feedback && !this.#busy && !actionError ? `<p role="status">${escapeText(this.#feedback)}</p>` : ""}
        ${actionError ? `<span class="error" role="alert">${escapeText(actionError)}</span>` : ""}
        <div class="actions">
          <button type="button" data-action="connect-existing" ${this.#busy ? "disabled" : ""}>${localized("messageList.connectSelectedBot")}</button>
          <button type="button" data-action="add-connection" ${this.#busy ? "disabled" : ""}>${localized("messageList.addBot")}</button>
          <button type="button" data-action="refresh" ${this.#busy ? "disabled" : ""}>${localized("messageList.refresh")}</button>
        </div>${connectionForm}
        ${binding}${this.#bindingError ? `<span class="error" role="alert">${escapeText(this.#bindingError)}</span>` : ""}
        <small>${localized("messageList.selectExistingApp")}</small>
      </section>`;
      this.querySelector<HTMLSelectElement>("select[name='thread-target']")?.addEventListener(
        "change",
        (event) => {
          this.#run("bind-thread", selectedId, (event.currentTarget as HTMLSelectElement).value);
        },
      );
      this.querySelector("select[name='bot-connection']")?.addEventListener("change", (event) => {
        this.#data = {
          ...this.#data,
          selectedConnectionId: (event.currentTarget as HTMLSelectElement).value,
        };
        this.#render();
      });
      this.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset.action;
          if (action === "add-connection") {
            this.#adding = true;
            this.#connectionDraft = this.#nextConnectionId();
            this.#connectionError = "";
            this.#render();
            this.querySelector<HTMLInputElement>("input[name='connection-id']")?.focus();
          } else if (action === "cancel-add") {
            this.#adding = false;
            this.#connectionDraft = "";
            this.#connectionError = "";
            this.#render();
          } else if (action) {
            this.#run(action);
          }
        });
      });
      const input = this.querySelector<HTMLInputElement>("input[name='connection-id']");
      input?.addEventListener("input", () => {
        this.#connectionDraft = input.value;
        this.#connectionError = "";
      });
      this.querySelector("form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const proposed = this.#connectionDraft.trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(proposed)) {
          this.#connectionError = i18n.t("messageList.use164LettersDigitsHyphensOrUnderscores");
          this.#render();
          return;
        }
        if (connections.some((item) => item.connectionId === proposed)) {
          this.#connectionError = i18n.t("messageList.thatConnectionIDAlreadyExists");
          this.#render();
          return;
        }
        this.#adding = false;
        this.#data = { ...this.#data, selectedConnectionId: proposed };
        this.#run("connect-existing", proposed);
      });
    }
  };
}

export function registerHostChannelSetupBlock(
  registry: CustomElementRegistry,
  tag: string,
  i18n: I18n,
) {
  if (!registry.get(tag)) registry.define(tag, channelBlock(i18n));
}

function escapeText(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => escapeCharacters[character] ?? character);
}

const escapeCharacters: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const styles = `
  :host { display: block; color: var(--foreground); font: inherit; }
  section { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--card); }
  header, .connection, .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  header span { color: var(--muted-foreground); font-size: 12px; }
  header [data-state="error"] { color: var(--destructive); }
  p, small { margin: 0; color: var(--muted-foreground); }
  section { min-width: 0; }
  .connection { flex-wrap: wrap; }
  .connection > span { flex: 0 0 auto; }
  .connection select { flex: 1 1 180px; min-width: 0; max-width: 100%; }
  .actions button { flex: 0 0 auto; }
  small, p { overflow-wrap: anywhere; }
  .stages { display: flex; flex-wrap: wrap; gap: 6px; }
  .stage { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted-foreground); }
  .stage i { width: 7px; height: 7px; border-radius: 999px; background: var(--muted-foreground); }
  .stage.ready i { background: var(--primary); }
  select, input, button { font: inherit; color: inherit; border: 1px solid var(--border); border-radius: 7px; background: var(--background); padding: 6px 9px; }
  button { cursor: pointer; }
  button:disabled { cursor: default; opacity: .55; }
  .actions { justify-content: flex-start; flex-wrap: wrap; }
  .add-connection { display: grid; gap: 8px; }
  .add-connection label { display: grid; gap: 5px; }
  .pair, .verified { padding: 9px; border-radius: 8px; background: var(--muted); }
  .pair { display: flex; justify-content: space-between; gap: 8px; }
  .verified { color: var(--primary); }
  .error { color: var(--destructive); font-size: 12px; }
`;
