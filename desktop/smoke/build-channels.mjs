import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { context, options, availablePort, waitHttp, waitFor } from "./runner.mjs";

const opts = options();
if (!opts["debug-package"] || !opts["release-package"])
  throw new Error("Pass --debug-package PATH --release-package PATH [--keep-run-root]");
const debug = context("build-channels-debug", { ...opts, "package-root": opts["debug-package"] });
const release = context("build-channels-release", {
  ...opts,
  "package-root": opts["release-package"],
});
const instances = [debug, release];
const report = {
  processMode: opts["single-process"] ? "single-process" : "normal",
  checks: [],
  packages: {},
};
let passed = false;
async function api(page, section, method, ...args) {
  const response = await page.evaluate(
    async ({ section, method, args }) => {
      try {
        return { ok: true, value: await (await import("/shell_api.js"))[section][method](...args) };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    { section, method, args },
  );
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
async function connect(instance) {
  instance.port ??= await availablePort(0);
  instance.child = instance.launch(instance.port, {
    singleProcess: Boolean(opts["single-process"]),
  });
  await waitHttp(`http://127.0.0.1:${instance.port}/json/version`, instance.child);
  instance.browser = await chromium.connectOverCDP(`http://127.0.0.1:${instance.port}`);
  instance.page = await waitFor(
    () =>
      instance.browser
        .contexts()
        .flatMap((item) => item.pages())
        .find((page) => page.url().startsWith("ovule://-/")),
    "native app page",
    60000,
  );
  await waitFor(
    async () => {
      await api(instance.page, "workspace", "snapshot");
      return true;
    },
    "working native ShellAPI",
    60000,
  );
}
async function restart(instance) {
  await instance.page
    .evaluate(async () => (await import("/tuffite.js")).window.close())
    .catch(() => {});
  await waitFor(
    () => instance.child.exitCode !== null || instance.child.signalCode !== null,
    "normal native shutdown",
    30000,
  );
  assert.equal(instance.child.exitCode, 0, "native shutdown failed");
  await instance.browser.close().catch(() => {});
  await connect(instance);
}
async function checkIsolation() {
  for (const [instance, marker] of [
    [debug, "DEBUG_ONLY"],
    [release, "RELEASE_ONLY"],
  ]) {
    await api(instance.page, "workspace", "createProject", marker);
    await instance.page.evaluate(
      (value) => localStorage.setItem("ovule.coexist.marker", value),
      marker,
    );
    const other = instance === debug ? release : debug;
    const own = await api(instance.page, "workspace", "snapshot");
    const peer = await api(other.page, "workspace", "snapshot");
    assert.ok(own.projects.some((item) => item.name === marker));
    assert.ok(!peer.projects.some((item) => item.name === marker), "metadata crossed profiles");
  }
  report.checks.push("simultaneous processes and independent projects");
  for (const instance of instances) {
    const peer = instance === debug ? release : debug;
    const before = await api(peer.page, "workspace", "snapshot");
    const expected = (await api(instance.page, "workspace", "snapshot")).projects;
    await restart(instance);
    const own = await api(instance.page, "workspace", "snapshot");
    assert.deepEqual(own.projects, expected);
    assert.equal(
      await instance.page.evaluate(() => localStorage.getItem("ovule.coexist.marker")),
      instance === debug ? "DEBUG_ONLY" : "RELEASE_ONLY",
    );
    assert.deepEqual((await api(peer.page, "workspace", "snapshot")).projects, before.projects);
    assert.equal(peer.child.exitCode, null, "restarting one package stopped its peer");
  }
  report.checks.push("independent projects/browser storage and restart persistence");
}
async function exchange(host, client, label) {
  const workspace = join(host.root, "shared-workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "roundtrip.md"), `${label} HOST ORIGINAL`);
  const shared = await api(host.page, "workspace", "shareWorkspaceLink", workspace, label);
  report.hosts ??= {};
  report.hosts[label] = shared.endpointId;
  if (Object.keys(report.hosts).length === 2)
    assert.notEqual(...Object.values(report.hosts), "Link identities crossed profiles");
  const initial = await api(
    client.page,
    "workspace",
    "testWorkspaceLink",
    shared.endpointAddrJson,
    shared.shareId,
  );
  assert.equal(initial.connected, false, "unpaired client gained access");
  assert.match(initial.detail, /approval/i);
  const pending = await waitFor(
    async () => {
      const status = await api(host.page, "workspace", "shareHostLink");
      const request = status.pending.find((item) => item.clientId === initial.clientId);
      return request && { status, request };
    },
    "pairing request",
    60000,
  );
  assert.match(pending.request.code, /^\d{6}$/);
  await api(
    client.page,
    "workspace",
    "submitWorkspaceLinkPairing",
    pending.status.endpointAddrJson,
    pending.status.shareId,
    pending.request.code,
  );
  const resource = shared.workspaces.find((item) => item.alias === label);
  assert.ok(resource, "Host did not publish the shared workspace");
  await api(host.page, "workspace", "setWorkspaceLinkAccess", {
    clientId: initial.clientId,
    workspaceIds: [resource.shareId],
    agentIds: [],
  });
  const tested = await waitFor(
    async () => {
      const value = await api(
        client.page,
        "workspace",
        "testWorkspaceLink",
        shared.endpointAddrJson,
        shared.shareId,
      );
      return value.connected && value;
    },
    "approved remote Host",
    60000,
  );
  assert.ok(tested.workspaces.some((item) => item.shareId === resource.shareId));
  const endpoint = await api(client.page, "workspace", "registerEndpoint", {
    displayName: label,
    transport: "tunnel",
    host: shared.endpointAddrJson,
    agentIds: tested.agentIds,
    workspaces: tested.workspaces,
  });
  const snapshot = await api(client.page, "workspace", "createThread", {});
  const thread = snapshot.threads.at(-1);
  assert.ok(thread);
  await api(client.page, "workspace", "bindWorkspace", {
    threadId: thread.id,
    kind: "tunnel",
    endpointId: endpoint.endpointId,
    resourceId: resource.shareId,
    root: resource.root,
    alias: label,
  });
  const remotePath = `${resource.root.replaceAll("\\", "/")}/roundtrip.md`;
  const original = await api(client.page, "content", "readMarkdown", thread.id, remotePath);
  assert.equal(original.content, `${label} HOST ORIGINAL`);
  const edited = `${label} REMOTE WRITE`;
  await api(client.page, "content", "saveMarkdown", thread.id, remotePath, edited);
  assert.equal(await readFile(join(workspace, "roundtrip.md"), "utf8"), edited);
  assert.equal(
    (await api(client.page, "content", "readMarkdown", thread.id, remotePath)).content,
    edited,
  );
  // A denied remote read must not fall back to the same machine's local path.
  await api(host.page, "workspace", "setWorkspaceLinkAccess", {
    clientId: initial.clientId,
    workspaceIds: [],
    agentIds: [],
  });
  const afterRevoke = await api(host.page, "workspace", "shareHostLink");
  assert.deepEqual(
    afterRevoke.devices.find((item) => item.clientId === initial.clientId).workspaceIds,
    [],
  );
  await assert.rejects(
    api(client.page, "content", "readMarkdown", thread.id, remotePath),
    /not granted|not paired|unauthor|access|denied|forbidden/i,
  );
  assert.equal(await readFile(join(workspace, "roundtrip.md"), "utf8"), edited);
  await api(host.page, "workspace", "setWorkspaceLinkAccess", {
    clientId: initial.clientId,
    workspaceIds: [resource.shareId],
    agentIds: [],
  });
  assert.equal(
    (await api(client.page, "content", "readMarkdown", thread.id, remotePath)).content,
    edited,
  );
  // The same relative filename belongs to the peer's distinct workspace.
  const peerFile = join(client.root, "shared-workspace", "roundtrip.md");
  if (label === "release-to-debug")
    assert.equal(await readFile(peerFile, "utf8"), "debug-to-release REMOTE WRITE");
  assert.equal(host.child.exitCode, null);
  assert.equal(client.child.exitCode, null);
  report.checks.push(
    `${label}: approval, remote Host registration, workspace read/write and access revocation`,
  );
}
try {
  assert.notEqual(resolve(debug.packageRoot), resolve(release.packageRoot));
  for (const [instance, name, identity] of [
    [debug, "debug", "io.ovule.desktop.debug"],
    [release, "release", "io.ovule.desktop"],
  ]) {
    await instance.claimPackage();
    const manifest = JSON.parse(
      await readFile(join(instance.packageRoot, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.application, identity);
    assert.equal(manifest.executable, name === "debug" ? "ovule-debug.exe" : "ovule.exe");
    report.packages[name] = {
      path: instance.packageRoot,
      identity,
      executable: manifest.executable,
      dataDirectory: instance.env.OVULE_DATA_DIR,
    };
    await connect(instance);
    const directories = await instance.page.evaluate(async () =>
      (await import("/tuffite.js")).path.directories(),
    );
    assert.ok(
      directories.data.includes(identity),
      "Framework data does not use the build identity",
    );
    assert.ok(
      directories.cache.includes(identity),
      "Framework cache does not use the build identity",
    );
    report.packages[name].frameworkDirectories = directories;
  }
  assert.notEqual(
    report.packages.debug.frameworkDirectories.data,
    report.packages.release.frameworkDirectories.data,
  );
  report.checks.push("native default Framework data/cache paths use different app identities");
  await checkIsolation();
  await exchange(debug, release, "debug-to-release");
  await exchange(release, debug, "release-to-debug");
  report.packages.debug.pid = debug.child.pid;
  report.packages.release.pid = release.child.pid;
  for (const instance of instances) {
    await instance.page.screenshot({ path: join(instance.artifacts, "coexistence.png") });
    await writeFile(
      join(instance.artifacts, "build-channels.json"),
      JSON.stringify(report, null, 2),
    );
  }
  passed = true;
  console.log(JSON.stringify(report, null, 2));
  console.log("build_channels=PASS");
} finally {
  for (const instance of instances) {
    await instance.browser?.close().catch(() => {});
    await instance.cleanup(passed);
  }
}
