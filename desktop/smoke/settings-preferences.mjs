export async function openGeneralSettings(page) {
  const toggle = page.locator(".titlebar [data-settings-toggle]");
  const panel = page.locator("[data-settings-panel]");
  if (!(await panel.isVisible())) await toggle.click();
  await panel.getByRole("button", { name: /^(General|常规)$/ }).click();
  return { toggle, panel };
}
export async function setThemeMode(page, mode) {
  const { toggle, panel } = await openGeneralSettings(page);
  await panel.locator(`[data-theme-choice="${mode}"]`).click();
  await page.waitForFunction((value) => document.documentElement.dataset.themeMode === value, mode);
  await toggle.click();
}
export async function setLanguageMode(page, mode) {
  const { toggle, panel } = await openGeneralSettings(page);
  await panel.locator(".language-toggle").click();
  await page
    .getByRole("option", {
      name:
        mode === "zh-CN" ? "简体中文" : mode === "en" ? "English" : /^(Follow system|跟随系统)$/,
    })
    .click();
  if (mode !== "system")
    await page.waitForFunction((value) => document.documentElement.lang === value, mode);
  await toggle.click();
}
