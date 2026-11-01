/** Preserve literal %, #, ? and Unicode names from native filesystem pickers. */
export function localPathUrl(selectedPath: string): string {
  const path = selectedPath.replaceAll("\\", "/");
  const url = new URL("file:///");
  let pathname = path;
  if (path.startsWith("//")) {
    const slash = path.indexOf("/", 2);
    url.hostname = path.slice(2, slash);
    pathname = path.slice(slash);
  } else if (/^[a-z]:\//i.test(path)) pathname = `/${path}`;
  url.pathname = pathname
    .split("/")
    .map((segment, index) =>
      index === 1 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment),
    )
    .join("/");
  return url.href;
}

export function directoryUrl(root: string): string {
  return localPathUrl(`${root.replaceAll("\\", "/").replace(/\/+$/, "")}/`);
}
