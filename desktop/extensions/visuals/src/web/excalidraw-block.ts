const { default: stylesheet } = await import(new URL("./web/blocks.css", import.meta.url).href, {
  with: { type: "css" },
});

class OvuleExcalidrawElement extends HTMLElement {
  set data(value) {
    this._data = value;
    this.render();
  }
  connectedCallback() {
    const root = this.getRootNode();
    if (root instanceof ShadowRoot && !root.adoptedStyleSheets.includes(stylesheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, stylesheet];
    }
    this.render();
  }
  render() {
    const elements = Array.isArray(this._data?.elements) ? this._data.elements.slice(0, 200) : [];
    const shapes = elements.map((element) => {
      const x = number(element.x, 0);
      const y = number(element.y, 0);
      const width = Math.max(1, number(element.width, 80));
      const height = Math.max(1, number(element.height, 40));
      const stroke = /^#[0-9a-f]{3,8}$/i.test(element.strokeColor ?? "")
        ? element.strokeColor
        : "#64748b";
      if (element.type === "ellipse")
        return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="none" stroke="${stroke}"/>`;
      if (element.type === "text")
        return `<text x="${x}" y="${y + 16}" fill="${stroke}">${escapeHtml(element.text ?? "")}</text>`;
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="none" stroke="${stroke}"/>`;
    });
    this.innerHTML = `<section class="ovule-visual-block"><header>${escapeHtml(this._data?.title ?? "Drawing")}</header><svg viewBox="0 0 640 320" role="img">${shapes.join("")}</svg></section>`;
  }
}
const number = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
export function registerMessageBlock(registry, tag = "ovule-excalidraw") {
  if (!registry.get(tag)) registry.define(tag, OvuleExcalidrawElement);
}
