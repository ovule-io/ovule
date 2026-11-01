import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createComposerService } from "./service";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
let revoked: string[];

beforeEach(() => {
  revoked = [];
  URL.createObjectURL = (value) => `blob:${(value as File).name}`;
  URL.revokeObjectURL = (value) => void revoked.push(value);
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

describe("composer service", () => {
  test("owns text and attachment lifecycle behind commands", async () => {
    const composer = createComposerService();
    composer.setText("draft");
    await composer.addImages([
      new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" }),
    ]);

    expect(composer.current().text).toBe("draft");
    expect(composer.current().attachments).toHaveLength(1);
    expect(composer.current().attachments[0].name).toBe("shot.png");

    composer.clear();
    expect(composer.current()).toEqual({
      text: "",
      attachments: [],
      attachmentError: undefined,
    });
    expect(revoked).toEqual(["blob:shot.png"]);
  });

  test("rejects unsupported attachments without exposing mutable store actions", async () => {
    const composer = createComposerService();
    await composer.addImages([new File(["text"], "notes.txt", { type: "text/plain" })]);

    expect(composer.current().attachments).toHaveLength(0);
    expect(composer.current().attachmentError).toBe("unsupportedImage");
    expect("setState" in composer).toBe(false);
  });
});

test("Thread switches preserve drafts and a completed send only clears its original context", async () => {
  const composer = createComposerService();
  composer.setText("new conversation draft");
  await composer.addImages([new File(["image"], "draft.png", { type: "image/png" })]);
  composer.selectContext("thread-a");
  expect(composer.current().text).toBe("");
  expect(composer.current().attachments).toHaveLength(0);
  composer.setText("other conversation");
  composer.clear("");
  expect(composer.current().text).toBe("other conversation");
  expect(revoked).toEqual(["blob:draft.png"]);
  composer.selectContext("");
  expect(composer.current().text).toBe("");
  composer.selectContext("thread-a");
  expect(composer.current().text).toBe("other conversation");
});
