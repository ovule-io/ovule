import JSZip from "jszip";

/** Normalize producer-specific OOXML in memory. ExcelJS cannot parse mixed
 * plain/rich string runs, or reassign worksheet names it truncated to 31 chars. */
export async function normalizeSpreadsheetStrings(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; sheetNames: Record<string, string> }> {
  const zip = await JSZip.loadAsync(bytes);
  let changed = false;
  const sheetNames: Record<string, string> = {};
  const renamed = new Map<string, string>();
  const parse = (source: string) => {
    if (source.length > 32 * 1024 * 1024) throw new Error("Spreadsheet XML exceeds 32 MiB");
    const xml = new DOMParser().parseFromString(source, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("Invalid spreadsheet XML");
    return xml;
  };
  const workbook = zip.file("xl/workbook.xml");
  if (workbook) {
    const xml = parse(await workbook.async("string"));
    const sheets = Array.from(xml.getElementsByTagNameNS("*", "sheet"));
    const names = new Set(
      sheets
        .map((sheet) => sheet.getAttribute("name") ?? "")
        .filter((name) => name.length <= 31)
        .map((name) => name.toLowerCase()),
    );
    for (const sheet of sheets) {
      const original = sheet.getAttribute("name") ?? "";
      if (original.length <= 31) continue;
      let canonical = original.slice(0, 31);
      let index = 1;
      while (names.has(canonical.toLowerCase())) {
        const suffix = ` (${index++})`;
        canonical = original.slice(0, 31 - suffix.length) + suffix;
      }
      names.add(canonical.toLowerCase());
      sheet.setAttribute("name", canonical);
      sheetNames[canonical] = original;
      renamed.set(original, canonical);
      changed = true;
    }
    // Keep names used by formulas/defined ranges consistent with the in-memory sheets.
    if (renamed.size) zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(xml));
  }
  for (const [name, file] of Object.entries(zip.files)) {
    if (
      file.dir ||
      !(
        name === "xl/sharedStrings.xml" ||
        name === "xl/workbook.xml" ||
        /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
      )
    )
      continue;
    const xml = parse(await file.async("string"));
    let normalized = false;
    for (const entry of [
      ...xml.getElementsByTagNameNS("*", "si"),
      ...xml.getElementsByTagNameNS("*", "is"),
    ]) {
      const children = Array.from(entry.children);
      if (!children.some((node) => node.localName === "r")) continue;
      for (const text of children.filter((node) => node.localName === "t")) {
        const run = xml.createElementNS(text.namespaceURI, text.prefix ? `${text.prefix}:r` : "r");
        entry.insertBefore(run, text);
        run.append(text);
        normalized = true;
      }
    }
    for (const formula of [
      ...xml.getElementsByTagNameNS("*", "f"),
      ...xml.getElementsByTagNameNS("*", "definedName"),
    ]) {
      let source = formula.textContent ?? "";
      for (const [original, canonical] of renamed) {
        source = source.replaceAll(
          `'${original.replaceAll("'", "''")}'!`,
          `'${canonical.replaceAll("'", "''")}'!`,
        );
      }
      if (source !== formula.textContent) {
        formula.textContent = source;
        normalized = true;
      }
    }
    if (normalized) {
      zip.file(name, new XMLSerializer().serializeToString(xml));
      changed = true;
    }
  }
  if (!changed) throw new Error("Spreadsheet could not be normalized");
  return {
    bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    sheetNames,
  };
}
