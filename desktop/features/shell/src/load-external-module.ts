/** Host assets are separate from the statically checked capability module graph. */
export function externalModuleUrl(value: string, base: string): string {
  const url = new URL(value, base);
  if (
    url.pathname !== "/tuffite.js" &&
    !/^\/(?:extensions|plugins)\/[^/]+\/dist\/web\//.test(url.pathname)
  )
    throw new Error(`Not a host Web module: ${value}`);
  return url.href;
}
export function loadExternalModule(value: string): Promise<unknown> {
  const url = externalModuleUrl(value, location.href);
  return import(/* @vite-ignore */ url);
}
