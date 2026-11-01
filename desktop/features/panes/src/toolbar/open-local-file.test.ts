import { expect, test } from "bun:test";
import { openLocalFile } from "./open-local-file";
import type { DialogApi, OpenFileDialogOptions } from "@ovule/shell/dialog";

for (const extension of ["md", "pdf", "doc", "docx", "xlsx", "png", "mp4", "unknown"]) {
  test(`Local files accepts .${extension} without an extension filter and opens the selected file`, async () => {
    let pickerOptions: OpenFileDialogOptions | undefined;
    const path = `/tmp/目录/a #?%.${extension}`;
    const opened: unknown[] = [];
    const updates: unknown[] = [];
    const dialog: DialogApi = {
      openFile: async (options) => {
        pickerOptions = options;
        return path;
      },
      openDirectory: async () => {
        throw new Error("Local files must use a file picker");
      },
      saveFile: async () => undefined,
    };
    const result = await openLocalFile({
      dialog: async () => dialog,
      panes: {
        openTab: (kind, options) => {
          opened.push([kind, options]);
          return "file-pane";
        },
        updateTab: (id, values) => {
          updates.push([id, values]);
        },
      },
      title: "Local files",
      options: { threadId: "thread", placement: "thread" },
    });
    expect(pickerOptions).toEqual({ title: "Local files" });
    expect(result).toEqual({ opened: true });
    expect(opened).toEqual([
      [
        "browser",
        {
          threadId: "thread",
          placement: "thread",
          newInstance: true,
          autoLoad: true,
          target: `file:///tmp/%E7%9B%AE%E5%BD%95/a%20%23%3F%25.${extension}`,
        },
      ],
    ]);
    expect(updates).toEqual([["file-pane", { title: `a #?%.${extension}` }]]);
  });
}

test("cancelling Local files leaves the existing panes intact", async () => {
  const result = await openLocalFile({
    dialog: async () => ({ openFile: async () => undefined }) as DialogApi,
    panes: {
      openTab: () => {
        throw new Error("unexpected new pane");
      },
      updateTab: () => {
        throw new Error("unexpected update");
      },
    },
    title: "Local files",
    options: { draftId: "draft", placement: "workbench" },
  });
  expect(result).toEqual({ opened: false });
});
