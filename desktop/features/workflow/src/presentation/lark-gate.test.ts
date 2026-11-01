import { expect, test } from "bun:test";
import { gateConnectionId, gateVerified, larkGateKind } from "./lark-gate";
const goal = { title: "配置 Lark channel bot", intent: "验证端到端连接" };
test("recognizes legacy Lark requirements without changing unrelated gates", () => {
  for (const [title, kind] of [
    ["在浏览器确认并授权应用权限", "authorization"],
    ["输入应用密钥或更新连接凭据", "credentials"],
    ["在私聊发送 /pair CODE 完成首位所有者配对", "pair"],
  ]) {
    expect(larkGateKind(goal, { kind: "gate", title })).toBe(kind);
    expect(
      larkGateKind({ title: "Ship release", intent: "Publish" }, { kind: "gate", title }),
    ).toBeUndefined();
    expect(larkGateKind(goal, { kind: "task", title })).toBeUndefined();
  }
  expect(larkGateKind(goal, { kind: "gate", title: "Approve installation" })).toBeUndefined();
});
test("requires evidence for each step and never chooses an arbitrary bot", () => {
  const connection = { connectionId: "one", configured: true };
  expect(gateVerified("authorization", connection)).toBe(false);
  expect(gateVerified("credentials", connection)).toBe(false);
  expect(gateVerified("authorization", { ...connection, provisioned: true })).toBe(true);
  expect(gateVerified("credentials", { ...connection, connected: true })).toBe(true);
  expect(gateVerified("pair", { ...connection, pairingCode: "123456", connected: true })).toBe(
    false,
  );
  expect(gateVerified("pair", { ...connection, ownerPaired: true, connected: true })).toBe(true);
  expect(
    gateVerified("pair", { ...connection, state: "error", ownerPaired: true, connected: true }),
  ).toBe(false);
  expect(gateConnectionId([connection, { connectionId: "two" }], "thread")).toBeUndefined();
  expect(
    gateConnectionId([connection, { connectionId: "two", boundThreadId: "thread" }], "thread"),
  ).toBe("two");
});
