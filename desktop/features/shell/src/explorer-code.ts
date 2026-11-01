import type { ExplorerElement } from "./explorer";

import { fileCodeLanguage } from "@ovule/file-types";
export { fileCodeLanguage } from "@ovule/file-types";

/** Decorate Chromium's text document in place, retaining native find, selection,
 * history and transfer. Never read or rewrite a remote or executable HTML page. */
export function installExplorerCode(element: ExplorerElement): () => void {
  let disposed = false;
  let revision = 0;
  let completedDocument = "";
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  const retrySoon = () => {
    if (!disposed && retries++ < 30) retry = setTimeout(update, 100);
  };
  const highlight = async () => {
    const current = ++revision;
    try {
      const state = await element.getNavigationState();
      const language = fileCodeLanguage(state.url);
      if (disposed || current !== revision) return;
      if ((!language || state.isLoading) && fileCodeLanguage(element.src)) retrySoon();
      if (
        disposed ||
        current !== revision ||
        !language ||
        !state.documentId ||
        state.isLoading ||
        completedDocument === state.documentId
      )
        return;
      const source = await element.executeJavaScript(
        `(() => {
        if (location.href !== ${JSON.stringify(state.url)} || location.protocol !== 'file:') return null;
        const pre = document.body?.querySelector(':scope > pre');
        if (!pre || pre.textContent.length > 500000) return null;
        return pre.textContent;
      })()`,
        { expectedDocumentId: state.documentId },
      );
      if (disposed || current !== revision) return;
      if (typeof source !== "string") {
        retrySoon();
        return;
      }
      const { code } = await import("@streamdown/code");
      const apply = (result: import("@streamdown/code").HighlightResult) => {
        if (disposed || current !== revision) return;
        const rows = result.tokens.map((line) =>
          line.map((token) => ({
            text: token.content,
            light: token.htmlStyle?.color ?? token.color,
            dark: token.htmlStyle?.["--shiki-dark"] ?? token.color,
          })),
        );
        void element
          .executeJavaScript(
            `(() => {
          if (location.href !== ${JSON.stringify(state.url)} || location.protocol !== 'file:') return;
          const pre = document.body?.querySelector(':scope > pre');
          if (!pre || pre.textContent !== ${JSON.stringify(source)}) return;
          const fragment = document.createDocumentFragment();
          const rows = ${JSON.stringify(rows)};
          rows.forEach((line, index) => {
            if (index) fragment.append(document.createTextNode('\\n'));
            for (const token of line) {
              const span = document.createElement('span');
              span.textContent = token.text;
              if (token.light) span.style.setProperty('--code-light', token.light);
              if (token.dark) span.style.setProperty('--code-dark', token.dark);
              fragment.append(span);
            }
          });
          pre.replaceChildren(fragment);
          pre.dataset.ovuleCode = ${JSON.stringify(language)};
          if (!document.getElementById('ovule-code-theme')) {
            const style = document.createElement('style');
            style.id = 'ovule-code-theme';
            style.textContent = 'html { color-scheme: light dark; background: light-dark(#fff, #0d1117); color: light-dark(#24292e, #e6edf3); } body { margin: 0; } pre[data-ovule-code] { margin: 0; padding: 20px 24px; font: 13px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 4; } pre[data-ovule-code] span { color: light-dark(var(--code-light, inherit), var(--code-dark, inherit)); }';
            document.head.append(style);
          }
        })()`,
            { expectedDocumentId: state.documentId },
          )
          .then(() => {
            if (!disposed && current === revision) completedDocument = state.documentId;
          })
          .catch(() => {});
      };
      const result = code.highlight(
        {
          code: source,
          language: language as Parameters<typeof code.highlight>[0]["language"],
          themes: code.getThemes(),
        },
        apply,
      );
      if (result) apply(result);
    } catch {
      // Unsupported and failed documents retain Chromium's original viewer.
    }
  };
  const update = () => {
    clearTimeout(retry);
    void highlight();
  };
  const invalidate = () => {
    revision++;
    completedDocument = "";
    retries = 0;
    clearTimeout(retry);
    retrySoon();
  };
  element.addEventListener("loadstart", invalidate);
  element.addEventListener("loadstop", update);
  element.addEventListener("loadcommit", update);
  element.addEventListener("attached", update);
  update();
  return () => {
    disposed = true;
    revision++;
    clearTimeout(retry);
    element.removeEventListener("loadstart", invalidate);
    element.removeEventListener("loadstop", update);
    element.removeEventListener("loadcommit", update);
    element.removeEventListener("attached", update);
  };
}
