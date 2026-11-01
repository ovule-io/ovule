import { expect, test } from "bun:test";
import { isTextKey, TextCommitter } from "./keyboard";
const key = (value: string, overrides: Partial<KeyboardEvent> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  getModifierState: () => false,
  ...overrides,
});
test("the first pinyin key stays local before compositionstart; shortcuts remain physical", () => {
  expect(isTextKey(key("y"))).toBe(true);
  expect(isTextKey(key("Y"))).toBe(true);
  expect(isTextKey(key("Dead"))).toBe(true);
  expect(isTextKey(key("c", { metaKey: true }))).toBe(false);
  expect(isTextKey(key("v", { ctrlKey: true }))).toBe(false);
  expect(isTextKey(key("ArrowLeft"))).toBe(false);
  expect(isTextKey(key("@", { ctrlKey: true, altKey: true, getModifierState: () => true }))).toBe(
    true,
  );
});
test("IME commits once with or without a final input event and allows repeated words", () => {
  const text = new TextCommitter();
  expect(text.compositionEnd("远程")).toBe("远程");
  expect(text.input("远程")).toBeUndefined();
  text.newKey();
  expect(text.compositionEnd("远程")).toBe("远程");
  text.newKey();
  expect(text.input("远程")).toBe("远程");
  expect(text.compositionEnd("")).toBeUndefined();
  expect(text.input("")).toBeUndefined();
});
