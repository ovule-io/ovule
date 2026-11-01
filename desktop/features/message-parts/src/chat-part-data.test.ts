import { expect, test } from "bun:test";
import { chatPartData, chatToolState, chatToolPresentation } from "./chat-part-data";
test("chat blocks tolerate partial payloads without inventing execution results", () => {
  expect(chatPartData('{"output":')).toEqual({});
  expect(chatPartData("[]")).toEqual({});
  expect(chatPartData(" ".repeat(300_000))).toEqual({});
  expect(chatToolState("running", true)).toBe("running");
  expect(chatToolState("running", false)).toBe("cancelled");
  expect(chatToolState("completed", false)).toBe("completed");
  expect(chatToolState("output-error", true)).toBe("failed");
});

test("tool result failures and invocation errors remain distinct", () => {
  expect(
    chatToolPresentation(
      { state: "failed", failureKind: "Process", output: { exit_code: 1 } },
      false,
    ),
  ).toBe("failed");
  expect(
    chatToolPresentation({ state: "failed", failureKind: "Timeout", error: "deadline" }, false),
  ).toBe("error");
  expect(
    chatToolPresentation(
      { state: "failed", failureKind: "PermissionDenied", output: { exit_code: 71 } },
      false,
    ),
  ).toBe("error");
  expect(
    chatToolPresentation({ state: "failed", failureKind: "Backend", error: "invalid path" }, false),
  ).toBe("error");
  expect(chatToolPresentation({ state: "completed", output: { exit_code: 3 } }, false)).toBe(
    "failed",
  );
  expect(chatToolPresentation({ state: "cancelled", output: { exit_code: 1 } }, false)).toBe(
    "cancelled",
  );
  expect(chatToolPresentation({ output: { isError: true } }, false, true)).toBe("failed");
});
