import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilePreviewState, filePreviewName } from "./file-preview-state";

test("large-file states show a friendly limit message without raw native errors", () => {
  const html = renderToStaticMarkup(
    <FilePreviewState
      error="TuffiteError: Local text preview exceeds 2 MiB"
      fileName="npm-lock.yaml"
    />,
  );
  expect(html).toContain("File is too large to preview");
  expect(html).toContain("2 MiB preview limit");
  expect(html).toContain("npm-lock.yaml");
  expect(html).not.toContain("TuffiteError");
  expect(html).toContain('role="alert"');
});
test("unsupported files have a dedicated empty state and safe decoded filenames", () => {
  const html = renderToStaticMarkup(<FilePreviewState kind="unsupported" fileName="archive.zip" />);
  expect(html).toContain("Preview unavailable");
  expect(html).toContain("format is not supported");
  expect(filePreviewName("file:///tmp/My%20Files/file%23name.zip")).toBe("file#name.zip");
  expect(filePreviewName("")).toBeUndefined();
});
