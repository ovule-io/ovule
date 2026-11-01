import { request } from "./isolated";

type Setup = {
  label: string;
  description: string;
  fields: { id: string; label: string; kind: string; placeholder?: string; required?: boolean }[];
  actions: { id: string; label: string; field?: string }[];
  links: { label: string; url: string }[];
  status: { authenticated: boolean; detail: string };
};
export function registerOnboarding(registry: CustomElementRegistry, config: Omit<Setup, "status">) {
  registry.define(
    "ovule-onboarding",
    class extends HTMLElement {
      static observedAttributes = ["lang"];
      attributeChangedCallback() {
        this.#render();
      }
      #setup?: Setup;
      #values: Record<string, string> = {};
      #busy = false;
      #hostBusy = false;
      #canCancel = false;
      set busy(value: boolean) {
        this.#hostBusy = value;
        this.#render();
      }
      set canCancel(value: boolean) {
        this.#canCancel = value;
        this.#render();
      }
      #expanded = false;
      #error = "";
      #progress = "";
      set setup(value: { status: Setup["status"] }) {
        this.#setup = { ...config, status: value.status };
        this.#render();
      }
      set progress(value: string) {
        this.#progress = value;
        this.#render();
      }
      connectedCallback() {
        this.#render();
      }
      #render() {
        if (!this.isConnected || !this.#setup) return;
        const setup = this.#setup;
        // Preserve focus while host status updates arrive.
        const focus =
          this.getRootNode() instanceof ShadowRoot
            ? (this.getRootNode() as ShadowRoot).activeElement
            : null;
        const focusedField = focus instanceof HTMLInputElement ? focus.name : undefined;
        const style = document.createElement("style");
        style.textContent = `:host{display:block;font:inherit;color:inherit}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}button,input{font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:8px;padding:8px 10px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}input{min-width:200px}p{font-size:13px;opacity:.8}h3{margin:0;font-size:15px}.error{color:#e66}`;
        const title = document.createElement("h3");
        title.textContent = setup.label;
        const detail = document.createElement("p");
        detail.textContent = setup.status.detail || setup.description;
        const actions = document.createElement("div");
        actions.className = "actions";
        const button = (label: string, handler: () => void) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = label;
          b.disabled = this.#busy || this.#hostBusy;
          b.addEventListener("click", handler);
          actions.append(b);
          return b;
        };
        for (const link of setup.links)
          button(link.label, () => {
            void request(this, "onboarding.open", { url: link.url }).catch((e) => {
              this.#error = String(e.message);
              this.#render();
            });
          });
        if (setup.status.authenticated && setup.fields.some((f) => f.kind === "secret"))
          button(
            this.lang.startsWith("zh")
              ? this.#expanded
                ? "隐藏 API key"
                : "更新 API key"
              : this.#expanded
                ? "Hide API key"
                : "Update API key",
            () => {
              this.#expanded = !this.#expanded;
              this.#render();
            },
          );
        const fields = setup.fields.filter(
          (f) => f.kind !== "secret" || !setup.status.authenticated || this.#expanded,
        );
        for (const field of fields) {
          const input = document.createElement("input");
          input.name = field.id;
          input.type = field.kind === "secret" ? "password" : "text";
          input.autocomplete = "off";
          input.placeholder = field.placeholder || field.label;
          input.setAttribute("aria-label", field.label);
          input.value = this.#values[field.id] ?? "";
          input.addEventListener("input", () => {
            this.#values[field.id] = input.value;
            for (const b of actions.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
              const action = setup.actions.find((a) => a.id === b.dataset.action)!;
              b.disabled =
                this.#busy ||
                this.#hostBusy ||
                Boolean(
                  action.field &&
                    (!this.#values[action.field]?.trim() ||
                      setup.fields.some((f) => f.required && !this.#values[f.id]?.trim())),
                );
            }
          });
          actions.append(input);
        }
        for (const action of setup.actions.filter(
          (a) => !a.field || !setup.status.authenticated || this.#expanded,
        )) {
          const b = button(action.label, () => {
            if (this.#busy) return;
            this.#busy = true;
            this.#error = "";
            this.#render();
            void request(this, "onboarding.action", {
              actionId: action.id,
              values: { ...this.#values },
            })
              .then(() => {
                this.#values = {};
                this.#expanded = false;
              })
              .catch((e) => {
                this.#error = String(e.message);
              })
              .finally(() => {
                this.#busy = false;
                if (this.isConnected) this.#render();
              });
          });
          b.dataset.action = action.id;
          b.disabled ||= Boolean(
            action.field &&
              (!this.#values[action.field]?.trim() ||
                setup.fields.some((f) => f.required && !this.#values[f.id]?.trim())),
          );
        }
        if (this.#busy && this.#canCancel) {
          const cancel = button(this.lang.startsWith("zh") ? "取消等待" : "Cancel waiting", () => {
            void request(this, "onboarding.cancel").catch((error) => {
              this.#error = String(error.message);
              this.#render();
            });
          });
          cancel.disabled = false;
        }
        const feedback = document.createElement("p");
        feedback.setAttribute("role", this.#error ? "alert" : "status");
        feedback.textContent = this.#error || this.#progress;
        feedback.className = this.#error ? "error" : "";
        this.replaceChildren(style, title, detail, actions, feedback);
        if (focusedField)
          this.querySelector<HTMLInputElement>(
            `input[name="${CSS.escape(focusedField)}"]`,
          )?.focus();
      }
    },
  );
}
