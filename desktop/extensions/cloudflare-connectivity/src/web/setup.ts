import { request } from "../isolated";
type Account = { id: string; name: string };
type SetupState = {
  phase?: string;
  pendingSave?: boolean;
  pendingAccount?: string;
  authorizationUrl?: string;
  userCode?: string;
  accounts?: Account[];
  detail?: string;
};
const ACTIVE = new Set(["installing", "authorizing", "loading-accounts", "creating"]);
export function registerMessageBlock(
  registry: CustomElementRegistry,
  tag = "ovule-cloudflare-connectivity",
) {
  if (registry.get(tag)) return;
  registry.define(
    tag,
    class extends HTMLElement {
      #state: SetupState = {};
      #pending = false;
      #checking = false;
      #lastRefresh?: Date;
      #account = "";
      #timer?: ReturnType<typeof setTimeout>;
      #error = "";
      #root = this.attachShadow({ mode: "open" });
      set data(_value: unknown) {
        this.#render();
      }
      set streaming(_value: boolean) {
        this.#render();
      }
      connectedCallback() {
        this.#render();
        this.#run("status");
      }
      disconnectedCallback() {
        if (this.#timer) clearTimeout(this.#timer);
      }
      #run(action: string, connectionId?: string, manual = false) {
        if (this.#pending) return;
        this.#pending = true;
        this.#checking = manual && action === "status";
        this.#lastRefresh = undefined;
        this.#error = "";
        this.#render();
        void request(this, "extension.action", { action, connectionId: connectionId ?? null })
          .then((detail) =>
            this.#result({ detail } as CustomEvent<{
              action?: string;
              data?: SetupState;
              error?: string;
            }>),
          )
          .catch((error) => {
            if (this.isConnected)
              this.#result({
                detail: { action, error: String(error.message ?? error) },
              } as CustomEvent<{ action?: string; data?: SetupState; error?: string }>);
          });
      }
      #result = (event: CustomEvent<{ action?: string; data?: SetupState; error?: string }>) => {
        if (
          !["status", "login", "accounts", "create", "cancel", "open", "open-external"].includes(
            event.detail.action ?? "",
          )
        )
          return;
        if (this.#checking && !event.detail.error && event.detail.data)
          this.#lastRefresh = new Date();
        this.#checking = false;
        this.#pending = false;
        if (event.detail.error) this.#error = event.detail.error;
        else if (event.detail.data) this.#state = event.detail.data;
        if (!this.#state.accounts?.some((account) => account.id === this.#account))
          this.#account = this.#state.accounts?.[0]?.id ?? "";
        this.#render();
        if (this.#timer) clearTimeout(this.#timer);
        if (ACTIVE.has(this.#state.phase ?? ""))
          this.#timer = setTimeout(() => {
            if (this.isConnected) this.#run("status");
          }, 1500);
      };
      #render() {
        const en = !(this.lang || document.documentElement.lang).toLowerCase().startsWith("zh");
        const text = (zh: string, english: string) => (en ? english : zh);
        this.#root.replaceChildren();
        const style = document.createElement("style");
        style.textContent = `:host{display:block;color:var(--foreground);font:inherit}.card{border:1px solid var(--line,#ddd);border-radius:12px;padding:18px;display:grid;gap:12px;background:var(--surface,#fff)}h3,p{margin:0}p,small{color:var(--muted-foreground,#666)}button,select,a{font:inherit;padding:8px 12px;border:1px solid var(--line,#ddd);border-radius:8px;color:inherit;background:var(--surface,#fff)}button:disabled{opacity:.5}a{display:inline-block;text-decoration:underline}code{font-size:18px}label{display:grid;gap:6px}.error{color:var(--destructive,#b42318)}.heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}h3{font-size:1em}.badge{font-size:.8em;padding:3px 8px;border-radius:999px;background:var(--surface-3,#f2f3f5);white-space:nowrap}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0;font-size:.9em}dt{color:var(--muted-foreground,#666)}dd{margin:0}ol{margin:0;padding-left:20px;display:grid;gap:4px;font-size:.9em}.help{font-size:.85em;line-height:1.5}`;
        const card = document.createElement("section");
        card.className = "card";
        card.setAttribute("aria-busy", String(this.#pending));
        const title = document.createElement("h3");
        title.textContent = text("Cloudflare 跨网络连接", "Cloudflare cross-network connection");
        const heading = document.createElement("div");
        heading.className = "heading";
        heading.append(title);
        if (this.#state.phase === "configured") {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = text("已保存", "Saved");
          heading.append(badge);
        }
        card.append(heading);
        const note = document.createElement("p");
        note.textContent = text(
          "配置当前这台 Host。其他设备只需配对，无需复制密钥。",
          "Configure this Host. Other devices only need pairing; no tokens to copy.",
        );
        card.append(note);
        const labels: Record<string, string> = {
          installing: text("正在准备连接工具…", "Preparing connection tools…"),
          authorizing: text(
            "请在浏览器完成 Cloudflare 授权",
            "Complete Cloudflare authorization in your browser",
          ),
          "loading-accounts": text("正在读取可用账户…", "Loading available accounts…"),
          creating: text(
            "正在创建并安全保存连接配置…",
            "Creating and securely saving the configuration…",
          ),
          "choose-account": text(
            "授权已完成，请选择账户",
            "Authorization complete. Choose an account",
          ),
          configured: text(
            "Host 配置已保存，将自动用于新建的远程桌面会话。",
            "Host configuration saved. New remote desktop sessions will use it automatically.",
          ),
          cancelled: text("配置已取消", "Setup cancelled"),
        };
        const status = document.createElement("p");
        status.textContent =
          labels[this.#state.phase ?? ""] ??
          text(
            "登录后自动配置连接服务",
            "Sign in to automatically configure the connection service",
          );
        card.append(status);
        const action = (label: string, name: string, id?: string) => {
          const button = document.createElement("button");
          button.textContent =
            name === "status" && this.#checking ? text("正在刷新…", "Refreshing…") : label;
          button.disabled = this.#pending;
          button.addEventListener("click", () => this.#run(name, id, true));
          card.append(button);
          return button;
        };
        if (this.#state.phase === "authorizing" && this.#state.authorizationUrl) {
          try {
            const url = new URL(this.#state.authorizationUrl);
            if (
              url.protocol === "https:" &&
              url.hostname === "dash.cloudflare.com" &&
              !url.username &&
              !url.password
            ) {
              action(text("在 Workbench 打开授权页面", "Open authorization in Workbench"), "open");
              action(
                text("在系统浏览器继续授权", "Continue authorization in system browser"),
                "open-external",
              );
              const help = document.createElement("small");
              help.textContent = text(
                "如果 Workbench 中的人机校验反复失败，可在系统浏览器继续同一次登录。请保持此 Host 的 Ovule 打开。",
                "If verification keeps failing in Workbench, continue the same login in your system browser. Keep Ovule open on this Host.",
              );
              card.append(help);
            }
          } catch {}
          if (this.#state.userCode) {
            const code = document.createElement("code");
            code.textContent = this.#state.userCode;
            card.append(code);
          }
        }
        if (this.#state.pendingSave) {
          action(text("重试安全保存", "Retry secure save"), "create", this.#state.pendingAccount);
        } else if (this.#state.phase === "choose-account") {
          const label = document.createElement("label");
          label.textContent = text("选择计费账户", "Choose the billing account");
          const select = document.createElement("select");
          select.setAttribute("aria-label", label.textContent);
          for (const account of this.#state.accounts ?? []) {
            const option = document.createElement("option");
            option.value = account.id;
            option.textContent = account.name;
            select.append(option);
          }
          select.value = this.#account;
          select.addEventListener("change", () => {
            this.#account = select.value;
            this.#render();
          });
          label.append(select);
          card.append(label);
          action(
            text("在此账户启用连接服务", "Enable connection service in this account"),
            "create",
            this.#account,
          ).disabled ||= !this.#account;
          const price = document.createElement("small");
          price.textContent = text(
            "中继流量可能由 Cloudflare 收费。",
            "Cloudflare may charge for relayed traffic.",
          );
          card.append(price);
        } else if (this.#state.phase === "configured") {
          const facts = document.createElement("dl");
          for (const [label, value] of [
            [
              text("配置位置", "Configured on"),
              text("当前 Host · 凭据已安全保存", "This Host · credentials stored securely"),
            ],
            [
              text("连接策略", "Connection policy"),
              text(
                "优先直连，需要时使用 Cloudflare TURN",
                "Direct when available; Cloudflare TURN when needed",
              ),
            ],
            [
              text("桌面连通性", "Desktop connectivity"),
              text("需从配对设备验证", "Verify from a paired device"),
            ],
          ]) {
            const term = document.createElement("dt");
            term.textContent = label;
            const detail = document.createElement("dd");
            detail.textContent = value;
            facts.append(term, detail);
          }
          card.append(facts);
          const steps = document.createElement("ol");
          for (const instruction of [
            text(
              "在另一台设备配对此 Host，然后打开远程桌面。",
              "Pair this Host from another device, then open Remote Desktop.",
            ),
            text(
              "在桌面底部查看实际路径：直连或 TURN。",
              "Check the desktop status bar for the actual route: Direct or TURN.",
            ),
            text(
              "选择“仅 TURN 中继”并重连，可在同一 Wi-Fi 下验证中继。",
              "Choose TURN only to reconnect and verify the relay, even on the same Wi-Fi.",
            ),
          ]) {
            const step = document.createElement("li");
            step.textContent = instruction;
            steps.append(step);
          }
          card.append(steps);
          const explanation = document.createElement("p");
          explanation.className = "help";
          explanation.textContent = text(
            "此卡片只显示本机配置状态；刷新不会测试 TURN 媒体连通性，也不代表当前桌面已使用中继。配置后请重新建立桌面连接。",
            "This card shows local setup status. Refresh does not test TURN media connectivity or confirm an active relay route. Reconnect the desktop after setup.",
          );
          card.append(explanation);
          action(text("刷新状态", "Refresh status"), "status");
        } else if (!ACTIVE.has(this.#state.phase ?? ""))
          action(text("登录 Cloudflare", "Sign in to Cloudflare"), "login");
        if (ACTIVE.has(this.#state.phase ?? "") && this.#state.phase !== "creating")
          action(text("取消", "Cancel"), "cancel");
        if (this.#lastRefresh) {
          const feedback = document.createElement("p");
          feedback.setAttribute("role", "status");
          feedback.setAttribute("aria-live", "polite");
          const time = this.#lastRefresh.toLocaleTimeString(en ? "en" : "zh-CN");
          feedback.textContent =
            this.#state.phase === "configured"
              ? text(
                  `已刷新 ${time} · 本机连接配置已保存。`,
                  `Refreshed ${time} · This Host’s configuration is saved.`,
                )
              : text(`状态已刷新 ${time}`, `Status refreshed ${time}`);
          card.append(feedback);
        }
        if (this.#error || this.#state.detail) {
          const error = document.createElement("p");
          error.className = "error";
          error.setAttribute("role", "alert");
          error.textContent = this.#error || this.#state.detail || "";
          card.append(error);
        }
        this.#root.append(style, card);
      }
    },
  );
}
