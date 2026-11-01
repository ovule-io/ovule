import type { i18n as I18n } from "i18next";
import type { HumanHandoffRequest } from "@ovule/workspace/contract";
import type { HandoffProtocolService } from "@ovule/message-parts/handoff/protocol";

export function registerHostHumanHandoffBlock(
  registry: CustomElementRegistry,
  tag: string,
  i18n: I18n,
  handoff: HandoffProtocolService,
) {
  if (registry.get(tag)) return;
  registry.define(
    tag,
    class extends HTMLElement {
      #data?: HumanHandoffRequest;
      #streaming = false;

      set data(value: unknown) {
        this.#data = handoff.parseHumanHandoff(value);
        this.#render();
      }

      set streaming(value: boolean) {
        this.#streaming = value;
        this.#render();
      }

      readonly #languageChanged = () => this.#render();

      disconnectedCallback() {
        i18n.off("languageChanged", this.#languageChanged);
      }

      connectedCallback() {
        i18n.on("languageChanged", this.#languageChanged);
        this.#render();
      }

      #render() {
        if (!this.isConnected) return;
        this.replaceChildren();
        const data = this.#data;
        const style = document.createElement("style");
        style.textContent = STYLES;
        const card = document.createElement("section");
        card.className = "card";
        if (!data) {
          card.textContent = i18n.t("messageList.humanHandoffDetailsAreUnavailable");
          card.setAttribute("role", "alert");
          this.append(style, card);
          return;
        }
        const header = document.createElement("header");
        const heading = document.createElement("div");
        const eyebrow = document.createElement("small");
        eyebrow.textContent = this.#streaming
          ? i18n.t("messageList.preparingHandoff")
          : i18n.t("handoff.eyebrow");
        const title = document.createElement("strong");
        title.textContent = data.title;
        heading.append(eyebrow, title);
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = data.protocol.toUpperCase();
        header.append(heading, badge);
        const instructions = document.createElement("p");
        instructions.textContent = data.instructions;
        card.append(header, instructions);
        if (data.appshotUrl) {
          const figure = document.createElement("figure");
          const image = document.createElement("img");
          image.src = data.appshotUrl;
          image.alt = data.appshotAlt ?? data.title;
          image.loading = "lazy";
          const caption = document.createElement("figcaption");
          caption.textContent = i18n.t("handoff.appshot");
          figure.append(image, caption);
          card.append(figure);
        }
        const footer = document.createElement("footer");
        const detail = document.createElement("small");
        detail.textContent = data.target
          ? redactTarget(data.target, i18n)
          : i18n.t("handoff.noEndpoint");
        const button = document.createElement("button");
        button.type = "button";
        button.disabled = this.#streaming;
        button.textContent = i18n.t("handoff.takeControl");
        button.addEventListener("click", () => {
          window.dispatchEvent(new CustomEvent("ovule:human-handoff", { detail: data }));
        });
        footer.append(detail, button);
        card.append(footer);
        this.append(style, card);
      }
    },
  );
}

function redactTarget(value: string, i18n: I18n): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return i18n.t("messageList.remoteSession");
  }
}

const STYLES = `
  :host { display: block; color: var(--foreground); font: 14px/1.5 var(--font-sans, system-ui); }
  .card { display: grid; gap: 12px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--surface); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  header > div { display: grid; min-width: 0; gap: 2px; }
  small { color: var(--muted-foreground); font-size: 12px; }
  strong { font-weight: 500; }
  p { margin: 0; color: var(--muted-foreground); }
  .badge { border: 1px solid var(--line); border-radius: 999px; padding: 2px 7px; color: var(--muted-foreground); font: 11px/1.5 var(--font-mono, monospace); }
  figure { margin: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); }
  img { display: block; width: 100%; max-height: 300px; object-fit: contain; }
  figcaption { padding: 6px 9px; color: var(--muted-foreground); font-size: 12px; }
  footer small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { flex: none; border: 1px solid var(--foreground); border-radius: 7px; padding: 6px 10px; background: var(--foreground); color: var(--background); font: inherit; cursor: pointer; }
  button:disabled { cursor: default; opacity: .5; }
`;
