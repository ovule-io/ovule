import { expect, test } from "bun:test";
import { createInstance } from "i18next";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

function leaves(value: Record<string, unknown>, prefix = ""): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === "object" && item
      ? leaves(item as Record<string, unknown>, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(item)]],
  );
}
test("bundled locales have matching keys and interpolation variables", () => {
  const english = new Map(leaves(en));
  const chinese = new Map(leaves(zh));
  expect([...english.keys()].sort()).toEqual([...chinese.keys()].sort());
  const parameters = (value: string) =>
    [...value.matchAll(/{{\s*([^}\s]+)\s*}}/g)].map((match) => match[1]).sort();
  for (const [key, value] of english)
    expect(parameters(chinese.get(key)!)).toEqual(parameters(value));
});
test("JSON resources localize counts and named actions", async () => {
  const locale = createInstance();
  await locale.init({
    resources: { en: { translation: en }, "zh-CN": { translation: zh } },
    lng: "en",
  });
  expect(locale.t("conversation.workspaceCount", { count: 2 })).toBe("2 workspaces");
  await locale.changeLanguage("zh-CN");
  expect(locale.t("conversation.workspaceCount", { count: 2 })).toBe("2 个工作区");
  expect(locale.t("browser.closeTab", { title: "示例" })).toBe("关闭 示例");
});
