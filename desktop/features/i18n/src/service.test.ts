import branding from "../../../../branding.json";
import { expect, test } from "bun:test";
import { createI18nService } from "./service";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
function create(language: "en" | "zh-CN" | "system" = "en") {
  let system = "en-US",
    systemChanged = () => {},
    storageChanged = (_value: "en" | "zh-CN" | "system") => {};
  let removed = 0;
  const service = createI18nService({
    resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
    initialMode: language,
    systemLanguage: () => system,
    persist: () => {},
    apply: () => {},
    observeSystem: (callback) => {
      systemChanged = callback;
      return () => {
        removed++;
      };
    },
    observeMode: (callback) => {
      storageChanged = callback;
      return () => {
        removed++;
      };
    },
  });
  return {
    service,
    system(value: string) {
      system = value;
      systemChanged();
    },
    storage: (value: "en" | "zh-CN" | "system") => storageChanged(value),
    removed: () => removed,
  };
}
test("language instances and changes are scoped, including system and storage preferences", () => {
  const first = create("system"),
    second = create();
  expect(first.service.instance).not.toBe(second.service.instance);
  first.system("zh-CN");
  expect(first.service.instance.language).toBe("zh-CN");
  expect(second.service.instance.language).toBe("en");
  first.storage("en");
  expect(first.service.current().languageMode).toBe("en");
  expect(first.service.instance.language).toBe("en");
  first.service.setLanguageMode("zh-CN");
  expect(first.service.instance.t("conversation.workspaceCount", { count: 2 })).toBe("2 个工作区");
  first.service.dispose();
  second.service.dispose();
  expect(first.removed()).toBe(2);
});

test("product prose uses the configured display name in both locales", () => {
  const { service } = create();
  expect(service.instance.t("fatal.loading")).toBe(`Loading ${branding.displayName}…`);
  service.setLanguageMode("zh-CN");
  expect(service.instance.t("fatal.loading")).toBe(`正在加载 ${branding.displayName}…`);
  service.dispose();
});
