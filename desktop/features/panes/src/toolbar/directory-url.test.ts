import { expect, test } from "bun:test";
import { directoryUrl } from "./directory-url";
test("picker directories preserve special characters and platform roots", () => {
  expect(directoryUrl("/tmp/a #?%/目录")).toBe("file:///tmp/a%20%23%3F%25/%E7%9B%AE%E5%BD%95/");
  expect(directoryUrl("C:\\work\\project")).toBe("file:///C:/work/project/");
  expect(directoryUrl("\\\\server\\share\\folder")).toBe("file://server/share/folder/");
  expect(directoryUrl("/")).toBe("file:///");
});

test("picker files preserve their basename and platform paths without a trailing slash", async () => {
  const { localPathUrl } = await import("./directory-url");
  expect(localPathUrl("C:\\work\\report #1.xlsx")).toBe("file:///C:/work/report%20%231.xlsx");
  expect(localPathUrl("\\\\server\\share\\clip.mp4")).toBe("file://server/share/clip.mp4");
  expect(localPathUrl("/tmp/notes.md")).toBe("file:///tmp/notes.md");
});
