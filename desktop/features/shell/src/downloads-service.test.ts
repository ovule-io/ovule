import { expect, test } from "bun:test";
import { createDownloadsService } from "./downloads-service";
import type { DownloadView } from "@ovule/shell-api";
import type { ExplorerDownload, ExplorerElement } from "./explorer";
const source: ExplorerDownload = {
  id: 1,
  path: "/profile/Downloads/guid/example.dmg",
  url: "https://example.test/file",
  filename: "example.dmg",
  mimeType: "application/octet-stream",
  state: "in-progress",
  receivedBytes: 50,
  totalBytes: 100,
  error: 0,
  navigation: false,
};
const completed: DownloadView = {
  id: "saved-1",
  source: source.path,
  path: "/chosen/example.dmg",
  filename: source.filename,
  url: source.url,
  bytes: 100n,
  createdAt: 1n,
  removed: false,
};
function fixture() {
  let rows: DownloadView[] = [];
  const calls: string[] = [];
  let finish: ((row: DownloadView) => void) | undefined;
  const service = createDownloadsService(async () => ({
    browser: {
      listDownloads: async () => rows,
      downloadDirectory: async () => "/chosen",
      setDownloadDirectory: async (path) => path,
      publishDownload: async () => {
        calls.push("publish");
        return new Promise<DownloadView>((resolve) => {
          finish = resolve;
        });
      },
      removeDownload: async (id) => {
        calls.push(`remove:${id}`);
        rows = rows.filter((row) => row.id !== id);
        return true;
      },
      revealDownload: async (id) => {
        calls.push(`reveal:${id}`);
        return true;
      },
    },
  }));
  return {
    service,
    calls,
    finish: (row = completed) => {
      rows = row.removed ? [] : [row];
      finish!(row);
    },
  };
}
const settle = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};
const owner = { cancelDownload: async () => true } as unknown as ExplorerElement;

test("pause and resume target the owning Explorer and retain resumable interrupted tasks", async () => {
  const { service } = fixture();
  const calls: string[] = [];
  const owner = {
    pauseDownload: async (id: number) => {
      calls.push(`pause:${id}`);
      return true;
    },
    resumeDownload: async (id: number) => {
      calls.push(`resume:${id}`);
      return true;
    },
  } as unknown as ExplorerElement;
  service.update(owner, source);
  const key = service.current().items[0].key;
  await service.pause(key);
  service.update(owner, { ...source, paused: true, canResume: true });
  await service.resume(key);
  service.update(owner, { ...source, state: "interrupted", canResume: true });
  await service.resume(key);
  expect(calls).toEqual(["pause:1", "resume:1", "resume:1"]);
  service.update(owner, { ...source, state: "cancelled", canResume: false });
  await expect(service.resume(key)).rejects.toThrow("Could not resume");
});

test("progress is observable, completion publishes once and replay retains the saved file identity", async () => {
  const { service, calls, finish } = fixture();
  service.update(owner, source);
  expect(service.current().items[0].receivedBytes).toBe(50);
  service.update(owner, { ...source, state: "complete", receivedBytes: 100 });
  service.update(owner, { ...source, state: "complete", receivedBytes: 100 });
  await settle();
  expect(calls).toEqual(["publish"]);
  finish();
  await settle();
  expect(service.current().items[0].savedPath).toBe("/chosen/example.dmg");
  service.update(owner, { ...source, state: "complete", receivedBytes: 100 });
  await settle();
  expect(calls).toEqual(["publish"]);
  await service.reveal(service.current().items[0].key);
  expect(calls).toContain("reveal:saved-1");
});

test("deleting a record prevents a browser replay from resurrecting it", async () => {
  const { service, calls, finish } = fixture();
  service.update(owner, { ...source, state: "complete" });
  await settle();
  finish();
  await settle();
  const key = service.current().items[0].key;
  await service.remove(key);
  service.update(owner, { ...source, state: "complete" });
  await service.refresh();
  expect(service.current().items).toEqual([]);
  expect(calls).toContain("remove:saved-1");
});

test("a deleted record stays removed when publishing finishes late", async () => {
  const { service, calls, finish } = fixture();
  service.update(owner, { ...source, state: "complete" });
  await settle();
  await service.remove(service.current().items[0].key);
  finish();
  await settle();
  expect(service.current().items).toEqual([]);
  expect(calls).toContain("remove:saved-1");
});
