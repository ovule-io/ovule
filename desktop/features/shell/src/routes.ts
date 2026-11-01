export function surfaceUrl(
  path: "/main" | "/thread" | "/pane" | "/explorer",
  values: Record<string, string | undefined> = {},
) {
  const url = new URL(path, location.href);
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) url.searchParams.set(key, value);
  return url.href;
}

export function navigateSurface(url: string) {
  history.pushState(null, "", url);
  window.dispatchEvent(new Event("ovule:route"));
}
