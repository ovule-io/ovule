import * as echarts from "echarts";

const { default: stylesheet } = await import(new URL("./web/blocks.css", import.meta.url).href, {
  with: { type: "css" },
});

class OvuleEChartsElement extends HTMLElement {
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

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._themeObserver?.disconnect();
    this._themeObserver = undefined;
    if (this._ensureFrame !== undefined) cancelAnimationFrame(this._ensureFrame);
    this._ensureFrame = undefined;
    this._chart?.dispose();
    this._chart = undefined;
  }

  render() {
    if (!this.isConnected) return;
    const option = this._data?.option ?? this._data;
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      this.showError("Chart data is unavailable.");
      return;
    }
    try {
      if (!this._surface) {
        this._surface = document.createElement("div");
        this._surface.className = "ovule-echarts-surface";
        // Layout must not depend on the extension stylesheet winning the
        // cold-load race. ECharts refuses to initialize a zero-sized surface.
        this._surface.style.width = "100%";
        this._surface.style.minHeight = "280px";
        this.replaceChildren(this._surface);
      }
      if (!this._resizeObserver) {
        this._resizeObserver = new ResizeObserver(() => {
          if (this._chart) this._chart.resize();
          else this.ensureChart();
        });
        this._resizeObserver.observe(this._surface);
      }
      if (!this._themeObserver) {
        this._themeObserver = new MutationObserver(() => {
          this._chart?.dispose();
          this._chart = undefined;
          this.ensureChart();
        });
        this._themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme", "data-theme-mode"],
        });
      }
      this.setAttribute("role", "img");
      this.setAttribute("aria-label", option.title?.text ?? "ECharts visualization");
      this.ensureChart();
      if (this._ensureFrame !== undefined) cancelAnimationFrame(this._ensureFrame);
      this._ensureFrame = requestAnimationFrame(() => {
        this._ensureFrame = undefined;
        this.ensureChart();
      });
    } catch (error) {
      console.error("Failed to render ECharts Message Block", error);
      this.showError("This chart could not be rendered.");
    }
  }

  createChart() {
    this._chart = echarts.init(this._surface, isDark() ? "dark" : undefined, {
      renderer: "canvas",
    });
  }

  ensureChart() {
    if (!this._surface || !this.isConnected) return;
    if (this._surface.clientWidth <= 0 || this._surface.clientHeight <= 0) return;
    if (!this._chart) this.createChart();
    this.updateChart();
  }

  updateChart() {
    const option = this._data?.option ?? this._data;
    this._chart?.setOption(
      {
        animationDuration: 320,
        backgroundColor: "transparent",
        ...structuredClone(option),
      },
      { notMerge: true, lazyUpdate: false },
    );
    requestAnimationFrame(() => this._chart?.resize());
  }

  showError(message) {
    this._chart?.dispose();
    this._chart = undefined;
    this._surface = undefined;
    const error = document.createElement("div");
    error.className = "ovule-visual-error";
    error.textContent = message;
    this.replaceChildren(error);
  }
}

function isDark() {
  const mode = document.documentElement.dataset.themeMode;
  return (
    mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export function registerMessageBlock(registry, tag = "ovule-echarts") {
  if (!registry.get(tag)) {
    registry.define(tag, OvuleEChartsElement);
  }
}
