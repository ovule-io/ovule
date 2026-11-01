import { windowsProbe } from "./platform/windows/adapter.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { selectTurnTransport } from "./relay-options.mjs";

const hostPort = Number(process.env.OVULE_E2E_HOST_PORT ?? "9257");
const clientPort = Number(process.env.OVULE_E2E_CLIENT_PORT ?? "9258");
const timeoutMs = Number(process.env.OVULE_E2E_TIMEOUT_MS ?? "90000");
const focusHost = async (page) => {
  if (process.platform === "darwin") {
    await page.evaluate(async () => {
      await import("/tuffite.js");
      await (await import("/tuffite.js")).window.focus();
    });
    return;
  }
  if (process.platform !== "win32" || !process.env.OVULE_E2E_HOST_PID) return;
  await windowsProbe("focus", process.env.OVULE_E2E_PACKAGE_ROOT, process.env.OVULE_E2E_HOST_PID);
};

const waitFor = async (probe, description, timeout = timeoutMs, intervalMs = 100) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
};

const concatBytes = (parts) => {
  const result = [];
  for (const part of parts) result.push(...part);
  return result;
};

const varint = (value) => {
  let remaining = BigInt(value);
  const result = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    result.push(byte);
  } while (remaining);
  return result;
};

const fieldVarint = (field, value) => concatBytes([varint(field << 3), varint(value)]);
const keyEventMessage = (usbKeycode, pressed) => {
  const fields = concatBytes([fieldVarint(2, pressed ? 1 : 0), fieldVarint(3, usbKeycode)]);
  return concatBytes([[0x1a], varint(fields.length), fields]);
};
const textEventMessage = (text) => {
  const bytes = [...new TextEncoder().encode(text)];
  const fields = concatBytes([[0x0a], varint(bytes.length), bytes]);
  return concatBytes([[0x2a], varint(fields.length), fields]);
};
const mouseEventMessage = ({ x, y, button, buttonDown }) => {
  const fields = [fieldVarint(1, x), fieldVarint(2, y)];
  if (button !== undefined) fields.push(fieldVarint(5, button));
  if (buttonDown !== undefined) fields.push(fieldVarint(6, buttonDown ? 1 : 0));
  const mouse = concatBytes(fields);
  return concatBytes([[0x22], varint(mouse.length), mouse]);
};

const sendChannelMessage = (page, channelName, bytes, sequence) =>
  page.evaluate(
    async ({ channelName: name, payload, sequence: explicitSequence }) => {
      const value = window.__ovuleRemoteControlE2e;
      const channel = name === "pointer" ? value.pointerChannel : value.eventChannel;
      if (channel.readyState !== "open") {
        throw new Error(`CRD ${name} channel is ${channel.readyState}`);
      }
      const packet = new Uint8Array(8 + payload.length);
      new DataView(packet.buffer).setBigUint64(
        0,
        explicitSequence === undefined ? ++value.inputSequence : BigInt(explicitSequence),
        true,
      );
      packet.set(payload, 8);
      channel.send(packet);
    },
    { channelName, payload: bytes, sequence },
  );

const apiPage = async (browser, label) =>
  waitFor(async () => {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      if (page.isClosed()) continue;
      // Thread Explorer documents expose the same ShellAPI but their lifetime
      // belongs to the main shell. Navigation can dispose that guest target.
      if (!/\/(?:index\.html|main)$/.test(new URL(page.url()).pathname)) continue;
      const ready = await page
        .evaluate(
          async () => typeof (await import("/shell_api.js")).workspace.shareHostLink === "function",
        )
        .catch(() => false);
      if (ready) return page;
    }
    return undefined;
  }, `${label} ShellAPI page`);

const diagnostics = [];
const watch = (page, label) => {
  page.on("console", (message) =>
    diagnostics.push(`${label}:console:${message.type()}:${message.text()}`),
  );
  page.on("pageerror", (error) =>
    diagnostics.push(`${label}:pageerror:${error.stack ?? error.message}`),
  );
};

let hostBrowser;
let clientBrowser;
let clientPage;
try {
  [hostBrowser, clientBrowser] = await Promise.all([
    chromium.connectOverCDP(`http://127.0.0.1:${hostPort}`),
    chromium.connectOverCDP(`http://127.0.0.1:${clientPort}`),
  ]);
  const hostPage = await apiPage(hostBrowser, "Host");
  clientPage = await apiPage(clientBrowser, "Client");
  watch(hostPage, "host");
  watch(clientPage, "client");

  let host = await hostPage.evaluate(async () =>
    (await import("/shell_api.js")).workspace.shareHostLink(),
  );
  if (host.requiresReset) {
    assert.equal(
      process.env.OVULE_E2E_ACCESS_FIXTURE,
      "corrupt",
      "repair is only allowed for the runner's isolated corrupt fixture",
    );
    const blocked = await clientPage.evaluate(async ({ endpointAddrJson, shareId }) => {
      try {
        return {
          result: await (
            await import("/shell_api.js")
          ).workspace.testWorkspaceLink(endpointAddrJson, shareId),
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }, host);
    assert.match(blocked.error ?? blocked.result?.detail ?? "", /receiving Host/);
    await clientPage.evaluate(async () =>
      (await import("/shell_api.js")).workspace.resetLinkHosts(),
    );
    assert.equal(
      (
        await hostPage.evaluate(async () =>
          (await import("/shell_api.js")).workspace.shareHostLink(),
        )
      ).requiresReset,
      true,
      "client reset must not pretend to repair the receiving Host",
    );
    host = await hostPage.evaluate(async () =>
      (await import("/shell_api.js")).workspace.repairLocalHostAccess(),
    );
    assert.equal(host.requiresReset, false);
    process.stdout.write("link_host_repair=ok repaired_on_receiver=true\n");
  } else if (process.env.OVULE_E2E_ACCESS_FIXTURE === "legacy") {
    assert.equal(
      host.shareId,
      "legacy-fixture-invitation-token",
      "migration must preserve the invitation",
    );
    process.stdout.write("link_access_migration=ok invitation_preserved=true\n");
  }
  if (process.env.OVULE_E2E_RESET_HOST_IDENTITY === "1") {
    const previous = host;
    host = await hostPage.evaluate(async () =>
      (await import("/shell_api.js")).workspace.resetLocalHostLinkIdentity(),
    );
    assert.notEqual(host.endpointId, previous.endpointId, "Host identity did not rotate");
    assert.notEqual(host.shareId, previous.shareId, "Host invitation did not rotate");
    assert.equal(host.requiresReset, false);
    assert.deepEqual(host.pending, []);
    assert.deepEqual(host.devices, []);
    process.stdout.write(
      "link_host_identity_reset=ok endpoint_rotated=true invitation_rotated=true pairings_cleared=true\n",
    );
  }
  const initial = await clientPage.evaluate(
    async ({ endpointAddrJson, shareId }) =>
      (await import("/shell_api.js")).workspace.testWorkspaceLink(endpointAddrJson, shareId),
    host,
  );
  assert.equal(initial.connected, false);
  assert.match(initial.detail, /waiting for Host approval/i);

  const pending = await waitFor(async () => {
    const status = await hostPage.evaluate(async () =>
      (await import("/shell_api.js")).workspace.shareHostLink(),
    );
    const request = status.pending.find((item) => item.clientId === initial.clientId);
    return request ? { status, request } : undefined;
  }, "Host pairing request from the independent Client");
  assert.match(pending.request.code, /^\d{6}$/);

  await clientPage.evaluate(
    async ({ endpointAddrJson, shareId, code }) =>
      (await import("/shell_api.js")).workspace.submitWorkspaceLinkPairing(
        endpointAddrJson,
        shareId,
        code,
      ),
    {
      endpointAddrJson: pending.status.endpointAddrJson,
      shareId: pending.status.shareId,
      code: pending.request.code,
    },
  );

  const tested = await waitFor(async () => {
    const result = await clientPage.evaluate(
      async ({ endpointAddrJson, shareId }) =>
        (await import("/shell_api.js")).workspace.testWorkspaceLink(endpointAddrJson, shareId),
      pending.status,
    );
    return result.connected ? result : undefined;
  }, "paired independent Client");
  assert.ok(tested.capabilities.includes("desktop.control"));

  const endpoint = await clientPage.evaluate(
    async ({ endpointAddrJson, agentIds, workspaces }) =>
      (await import("/shell_api.js")).workspace.registerEndpoint({
        displayName: "Dual-instance CRD Host",
        transport: "tunnel",
        host: endpointAddrJson,
        agentIds,
        workspaces,
      }),
    {
      endpointAddrJson: pending.status.endpointAddrJson,
      agentIds: tested.agentIds,
      workspaces: tested.workspaces,
    },
  );

  const started = await clientPage.evaluate(
    async ({ endpointId, requireRelay }) => {
      const sessionId = await (
        await import("/shell_api.js")
      ).remoting.start(endpointId, {
        authKey: crypto.randomUUID().replaceAll("-", ""),
        maxBitrateKbps: 30_000,
        targetFramerate: 60,
      });
      const peer = new RTCPeerConnection({ iceTransportPolicy: requireRelay ? "relay" : "all" });
      const bootstrapChannel = peer.createDataChannel("event");
      const eventChannel = peer.createDataChannel("input-sequenced");
      const pointerChannel = peer.createDataChannel("pointer-latest", {
        ordered: false,
        maxRetransmits: 0,
      });
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.dataset.ovuleRemoteControlE2e = "true";
      video.style.cssText =
        "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;background:#000";
      document.body.append(video);
      const state = {
        endpointId,
        sessionId: sessionId,
        peer,
        requireRelay,
        eventChannel,
        bootstrapChannel,
        inputSequence: 0n,
        pointerChannel,
        incomingChannels: [],
        video,
        afterSequence: 0n,
        signalCount: 0,
        trackCount: 0,
        pendingCandidates: [],
        iceConfigured: false,
        iceServers: [],
        errors: [],
        iceErrors: [],
      };
      peer.onicecandidateerror = (event) => state.iceErrors.push({ code: event.errorCode });
      eventChannel.binaryType = "arraybuffer";
      eventChannel.onerror = () => state.errors.push("CRD event data channel failed");
      pointerChannel.binaryType = "arraybuffer";
      pointerChannel.onerror = () => state.errors.push("CRD pointer data channel failed");
      peer.ondatachannel = (event) => {
        event.channel.binaryType = "arraybuffer";
        state.incomingChannels.push(event.channel);
        event.channel.onerror = () =>
          state.errors.push(`CRD ${event.channel.label} data channel failed`);
      };
      peer.ontrack = (event) => {
        state.trackCount += 1;
        video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void video.play().catch((error) => state.errors.push(String(error)));
      };
      peer.onicecandidate = async (event) => {
        if (!event.candidate) return;
        void (await import("/shell_api.js")).remoting
          .signal(sessionId, {
            sequence: 0n,
            candidates: [
              {
                mid: event.candidate.sdpMid ?? "0",
                mLineIndex: event.candidate.sdpMLineIndex ?? 0,
                candidate: event.candidate.candidate,
              },
            ],
          })
          .catch((error) => state.errors.push(String(error)));
      };
      window.__ovuleRemoteControlE2e = state;
      return { id: sessionId.toString(), state: "connecting" };
    },
    { endpointId: endpoint.endpointId, requireRelay: process.env.OVULE_E2E_REQUIRE_RELAY === "1" },
  );
  assert.ok(BigInt(started.id) > 0n);
  const hostIceReport = await waitFor(
    () =>
      clientPage.evaluate(async () => {
        const value = window.__ovuleRemoteControlE2e;
        const update = await (await import("/shell_api.js")).remoting.snapshot(value.sessionId, 0n);
        if (update.state === "failed")
          throw new Error(update.error ?? "Host session failed before ICE configuration");
        return update.iceServers?.length
          ? { servers: update.iceServers, warning: update.error }
          : undefined;
      }),
    "Host ICE configuration",
  );
  const selectedIceServers = selectTurnTransport(
    hostIceReport.servers,
    process.env.OVULE_E2E_TURN_TRANSPORT ?? "all",
  );
  if (
    process.env.OVULE_E2E_REQUIRE_RELAY === "1" &&
    !selectedIceServers.some((server) => server.urls.some((url) => /^turns?:/.test(url)))
  )
    throw new Error(
      `Host supplied no TURN URLs for the requested transport${hostIceReport.warning ? `: ${hostIceReport.warning}` : ""}`,
    );
  await clientPage.evaluate(async (servers) => {
    window.__ovuleRemoteControlE2e.selectedIceServers = servers;
  }, selectedIceServers);

  const connected = await waitFor(async () => {
    const serializedState = await clientPage.evaluate(async () => {
      let phase = "state";
      try {
        const value = window.__ovuleRemoteControlE2e;
        if (!value) throw new Error("Remote Control E2E state is missing");
        phase = "takeSignals";
        const update = await (
          await import("/shell_api.js")
        ).remoting.snapshot(value.sessionId, value.afterSequence);
        if (update.state === "failed" || update.state === "stopped") {
          throw new Error(`Remote Control ${update.state}: ${update.error ?? "no detail"}`);
        }
        if (update.iceServers && !value.iceConfigured) {
          const iceServers = value.selectedIceServers;
          value.peer.setConfiguration({
            iceServers,
            iceTransportPolicy: value.requireRelay ? "relay" : "all",
          });
          value.iceServers = iceServers;
          value.iceConfigured = true;
        }
        for (const signal of update.signals) {
          value.signalCount += 1;
          if (signal.sequence > value.afterSequence) value.afterSequence = signal.sequence;
          if (signal.description) {
            if (!value.iceConfigured) throw new Error("Host ICE configuration is missing");
            phase = `setRemoteDescription:${signal.description.type}`;
            await value.peer.setRemoteDescription({
              type: signal.description.type,
              sdp: signal.description.sdp,
            });
            if (signal.description.type === "offer") {
              phase = "createAnswer";
              const answer = await value.peer.createAnswer();
              phase = "setLocalDescription:answer";
              await value.peer.setLocalDescription(answer);
              phase = "processSignal:answer";
              await (
                await import("/shell_api.js")
              ).remoting.signal(value.sessionId, {
                sequence: 0n,
                description: { type: answer.type, sdp: answer.sdp ?? "" },
                candidates: [],
              });
            }
            for (const candidate of value.pendingCandidates.splice(0)) {
              phase = "addIceCandidate:pending";
              await value.peer.addIceCandidate(candidate);
            }
          }
          for (const candidate of signal.candidates) {
            const valueCandidate = {
              sdpMid: candidate.mid,
              sdpMLineIndex: candidate.mLineIndex,
              candidate: candidate.candidate,
            };
            if (value.peer.remoteDescription) {
              phase = "addIceCandidate:remote";
              await value.peer.addIceCandidate(valueCandidate);
            } else value.pendingCandidates.push(valueCandidate);
          }
        }
        return JSON.stringify({
          connectionState: value.peer.connectionState,
          iceConnectionState: value.peer.iceConnectionState,
          signalCount: value.signalCount,
          trackCount: value.trackCount,
          eventChannelState: value.eventChannel.readyState,
          pointerChannelState: value.pointerChannel.readyState,
          pointerChannelOrdered: value.pointerChannel.ordered,
          pointerChannelMaxRetransmits: value.pointerChannel.maxRetransmits,
          incomingChannels: value.incomingChannels.map((channel) => ({
            label: channel.label,
            state: channel.readyState,
          })),
          videoWidth: value.video.videoWidth,
          videoHeight: value.video.videoHeight,
          readyState: value.video.readyState,
          errors: value.errors,
          iceConfigured: value.iceConfigured,
          iceServerCount: value.iceServers.length,
          turnServerCount: value.iceServers.filter((server) =>
            server.urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
          ).length,
          turnCredentialCount: value.iceServers.filter(
            (server) => server.username && server.credential,
          ).length,
          afterSequence: value.afterSequence.toString(),
        });
      } catch (error) {
        return JSON.stringify({
          evaluationError: `${phase}: ${error instanceof Error ? error.message : String(error)}`,
          evaluationStack: error instanceof Error ? error.stack : undefined,
        });
      }
    });
    if (serializedState === undefined) {
      throw new Error("Client CDP returned undefined while polling CRD signaling");
    }
    const state = JSON.parse(serializedState);
    if (state.evaluationError) {
      throw new Error(`Client signaling evaluation failed: ${state.evaluationError}`);
    }
    if (state.errors.length) throw new Error(`Client WebRTC errors: ${state.errors.join("; ")}`);
    if (!state.iceConfigured || state.iceServerCount < 1) return undefined;
    const expectsTurn = process.env.OVULE_E2E_TURN_FIXTURE === "1";
    if (expectsTurn && (state.turnServerCount !== 1 || state.turnCredentialCount !== 1)) {
      throw new Error(`Host-owned TURN configuration was not delivered: ${JSON.stringify(state)}`);
    }
    if (process.env.OVULE_E2E_REQUIRE_RELAY === "1" && state.turnCredentialCount < 1)
      throw new Error(
        "Real relay verification received no authenticated TURN server from the Host",
      );
    return state.connectionState === "connected" &&
      state.eventChannelState === "open" &&
      state.pointerChannelState === "open" &&
      state.pointerChannelOrdered === false &&
      state.pointerChannelMaxRetransmits === 0 &&
      state.incomingChannels.some(
        (channel) => channel.label === "control" && channel.state === "open",
      ) &&
      state.trackCount > 0 &&
      state.videoWidth > 0 &&
      state.videoHeight > 0 &&
      state.readyState >= 2
      ? state
      : undefined;
  }, "CRD WebRTC connection and decoded desktop frame");
  process.stdout.write(
    `remote_control_host_ice=ok host_owned=true turn_fixture=${process.env.OVULE_E2E_TURN_FIXTURE === "1"}\n`,
  );

  const stats = await clientPage.evaluate(async () => {
    const value = window.__ovuleRemoteControlE2e;
    value.heartbeat = setInterval(
      async () =>
        void (await import("/shell_api.js")).remoting
          .snapshot(value.sessionId, value.afterSequence)
          .catch(() => {}),
      5000,
    );
    const reports = await value.peer.getStats();
    const video = [...reports.values()].find(
      (report) => report.type === "inbound-rtp" && report.kind === "video",
    );
    const transport = [...reports.values()].find(
      (report) => report.type === "transport" && report.selectedCandidatePairId,
    );
    const pair =
      reports.get(transport?.selectedCandidatePairId) ??
      [...reports.values()].find(
        (report) =>
          report.type === "candidate-pair" && report.nominated && report.state === "succeeded",
      );
    return {
      bytesReceived: video?.bytesReceived,
      framesDecoded: video?.framesDecoded,
      localCandidateType: reports.get(pair?.localCandidateId)?.candidateType,
      remoteCandidateType: reports.get(pair?.remoteCandidateId)?.candidateType,
      protocol: reports.get(pair?.localCandidateId)?.protocol,
      relayProtocol: reports.get(pair?.localCandidateId)?.relayProtocol,
      pairState: pair?.state,
    };
  });
  assert.ok(stats.bytesReceived > 0);
  assert.ok(stats.framesDecoded > 0);
  if (process.env.OVULE_E2E_REQUIRE_RELAY === "1") {
    assert.equal(
      stats.localCandidateType,
      "relay",
      "Relay-only verification must select a relay candidate",
    );
    process.stdout.write(
      `remote_control_real_turn=ok local_candidate=relay remote_candidate=${stats.remoteCandidateType} transport=${process.env.OVULE_E2E_TURN_TRANSPORT ?? "all"} relay_protocol=${stats.relayProtocol} frames_decoded=${stats.framesDecoded} scope=local_dual_instance\n`,
    );
  }

  if (process.env.OVULE_E2E_SCOPE === "connection") {
    if (process.env.OVULE_E2E_REQUIRE_RELAY === "1") {
      await hostPage.setContent(
        "<!doctype html><html><body><textarea id='relay-input' autofocus></textarea></body></html>",
      );
      await hostPage.bringToFront();
      await focusHost(hostPage);
      await hostPage.evaluate(async () => {
        document.querySelector("#relay-input").focus();
        window.__relayShift = { down: false, up: false };
        document.addEventListener("keydown", (event) => {
          if (event.code === "ShiftLeft") window.__relayShift.down = true;
        });
        document.addEventListener("keyup", (event) => {
          if (event.code === "ShiftLeft") window.__relayShift.up = true;
        });
      });
      await waitFor(
        () =>
          hostPage.evaluate(
            async () => document.hasFocus() && document.activeElement?.id === "relay-input",
          ),
        "focused relay input fixture",
      );
      await sendChannelMessage(clientPage, "event", keyEventMessage(0x0700e1, true));
      await sendChannelMessage(clientPage, "event", keyEventMessage(0x0700e1, false));
      await sendChannelMessage(clientPage, "event", textEventMessage("Ovule TURN 输入"));
      await waitFor(
        () =>
          hostPage.evaluate(
            async () =>
              window.__relayShift.down &&
              window.__relayShift.up &&
              document.querySelector("#relay-input").value === "Ovule TURN 输入",
          ),
        "keyboard and Unicode text through TURN",
      );
      process.stdout.write(
        "remote_control_relay_input=ok key_down=true key_up=true unicode=true\n",
      );
    }
    await clientPage.evaluate(async () => {
      const value = window.__ovuleRemoteControlE2e;
      clearInterval(value.heartbeat);
      await (await import("/shell_api.js")).remoting.stop(value.sessionId);
    });
    await waitFor(
      () =>
        clientPage.evaluate(async () => {
          const value = window.__ovuleRemoteControlE2e;
          try {
            const update = await (
              await import("/shell_api.js")
            ).remoting.snapshot(value.sessionId, value.afterSequence);
            if (update.state === "failed") throw new Error(update.error ?? "remote cleanup failed");
            return update.state === "stopped";
          } catch (error) {
            if (error instanceof Error && error.message.includes("session is closed")) return true;
            throw error;
          }
        }),
      "stopped remote session cleanup",
    );
    process.stdout.write(
      `remote_control_connection=ok separate_apps=true sdp=true ice=true control_channel=true event_channel=true pointer_channel=true decoded_frame=${connected.videoWidth}x${connected.videoHeight} frames_decoded=${stats.framesDecoded} stop=true\n`,
    );
  } else if (process.env.OVULE_E2E_SCOPE === "controller") {
    await clientPage.evaluate(async () => {
      const value = window.__ovuleRemoteControlE2e;
      clearInterval(value.heartbeat);
      value.peer.close();
      value.video.remove();
      await (await import("/shell_api.js")).remoting.stop(value.sessionId);
      delete window.__ovuleRemoteControlE2e;
    });
    const controllerUrl = new URL("/pane", clientPage.url());
    controllerUrl.searchParams.set("kind", "spice");
    controllerUrl.searchParams.set("tab", "remote-control-ice-e2e");
    controllerUrl.searchParams.set(
      "target",
      `remote-control-session:${encodeURIComponent(JSON.stringify({ endpointId: endpoint.endpointId, displayName: "ICE controller smoke" }))}`,
    );
    await clientPage.goto(controllerUrl.href);
    assert.equal(
      await clientPage.locator('input[aria-label="STUN / TURN servers"]').count(),
      0,
      "Host-owned ICE configuration must not be exposed in the Remote Control UI",
    );
    await clientPage.waitForFunction(
      async () =>
        document.querySelector('[data-remote-control-session="connected"]') &&
        document.querySelector("video")?.videoWidth > 0,
      undefined,
      { timeout: timeoutMs },
    );
    await clientPage.evaluate(async () => {
      window.__ovuleControllerStream = document.querySelector("video").srcObject;
    });
    // The embedded pane receives actions from the registered outer pane toolbar.
    await clientPage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ovule:pane-command", {
          detail: { action: "remote.reconnect" },
        }),
      ),
    );
    await clientPage.waitForFunction(
      async () =>
        document.querySelector('[data-remote-control-session="connected"]') &&
        document.querySelector("video")?.srcObject &&
        document.querySelector("video").srcObject !== window.__ovuleControllerStream &&
        document.querySelector("video").videoWidth > 0,
      undefined,
      { timeout: timeoutMs },
    );
    process.stdout.write(
      "remote_control_ice_controller=ok first_frame=true reconnect=true host_owned_ice=true\n",
    );
  } else {
    // Native Explorer surfaces have their own hit-test regions; an arbitrary DOM
    // overlay cannot serve as a reliable system-input fixture above those views.
    // Replacing the Host document also verifies that the backend session survives
    // independently of the application UI.
    await hostPage.setContent(
      "<!doctype html><html><head><title>Remote Control input fixture</title></head><body style='margin:0;background:white'></body></html>",
    );
    await hostPage.bringToFront();
    await focusHost(hostPage);
    await hostPage.evaluate(async () => {
      const input = document.createElement("textarea");
      input.id = "ovule-crd-e2e-text-target";
      input.style.cssText =
        "position:fixed;left:24px;top:48px;width:320px;height:80px;z-index:2147483647";
      document.body.append(input);
      input.focus();
      window.__ovuleShiftE2e = { down: 0, up: 0, events: [] };
      input.addEventListener("keydown", (event) => {
        if (window.__ovuleShiftE2e.events.length < 10)
          window.__ovuleShiftE2e.events.push(
            event.key === "Shift" ? `down:${event.code}` : "down:non-shift",
          );
        if (event.code === "ShiftLeft") window.__ovuleShiftE2e.down++;
      });
      input.addEventListener("keyup", (event) => {
        if (window.__ovuleShiftE2e.events.length < 10)
          window.__ovuleShiftE2e.events.push(
            event.key === "Shift" ? `up:${event.code}` : "up:non-shift",
          );
        if (event.code === "ShiftLeft") window.__ovuleShiftE2e.up++;
      });
    });
    await waitFor(
      () =>
        hostPage.evaluate(
          async () =>
            document.hasFocus() && document.activeElement?.id === "ovule-crd-e2e-text-target",
        ),
      "focused Host text target",
    );
    await sendChannelMessage(clientPage, "event", keyEventMessage(0x0700e1, true));
    await sendChannelMessage(clientPage, "event", keyEventMessage(0x0700e1, false));
    await waitFor(
      () =>
        hostPage.evaluate(
          async () => window.__ovuleShiftE2e.down === 1 && window.__ovuleShiftE2e.up === 1,
        ),
      "standalone USB HID Shift tap",
      Math.min(timeoutMs, 15000),
      5,
    ).catch(async (error) => {
      diagnostics.push(
        `shift_host=${JSON.stringify(await hostPage.evaluate(async () => ({ ...window.__ovuleShiftE2e, focused: document.hasFocus(), active: document.activeElement?.id })))}`,
      );
      diagnostics.push(
        `shift_channel=${JSON.stringify(
          await clientPage.evaluate(async () => {
            const value = window.__ovuleRemoteControlE2e;
            return {
              sequence: value.inputSequence.toString(),
              state: value.eventChannel.readyState,
              buffered: value.eventChannel.bufferedAmount,
              channels: [...(await value.peer.getStats()).values()].filter(
                (report) => report.type === "data-channel",
              ),
            };
          }),
        )}`,
      );
      throw error;
    });
    const inputStarted = performance.now();
    await clientPage.evaluate(async (text) => {
      const value = window.__ovuleRemoteControlE2e;
      const encoded = new TextEncoder().encode(text);
      const assertSmall = (length) => {
        if (length >= 128) throw new Error("E2E text payload is too large");
        return length;
      };
      const innerLength = 2 + encoded.byteLength;
      const message = new Uint8Array(2 + innerLength);
      message.set([0x2a, assertSmall(innerLength), 0x0a, assertSmall(encoded.byteLength)]);
      message.set(encoded, 4);
      const packet = new Uint8Array(8 + message.byteLength);
      new DataView(packet.buffer).setBigUint64(0, ++value.inputSequence, true);
      packet.set(message, 8);
      value.eventChannel.send(packet);
    }, "中文");
    await waitFor(
      () =>
        hostPage.evaluate(
          async () => document.querySelector("#ovule-crd-e2e-text-target")?.value === "中文",
        ),
      "direct CRD event-channel text injection",
      timeoutMs,
      5,
    );
    const inputLatencyMs = Math.round(performance.now() - inputStarted);
    process.stdout.write(`remote_control_input=ok shift=true text_ms=${inputLatencyMs}\n`);
    await hostPage.evaluate(async () =>
      document.querySelector("#ovule-crd-e2e-text-target")?.remove(),
    );

    const dragGeometry = await hostPage.evaluate(async () => {
      const surface = document.createElement("div");
      surface.id = "ovule-crd-e2e-drag-surface";
      surface.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:crosshair;touch-action:none";
      document.body.append(surface);
      const state = {
        down: false,
        downCount: 0,
        moveCount: 0,
        dragMoveCount: 0,
        upCount: 0,
        lastX: -1,
        lastY: -1,
      };
      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        state.down = true;
        state.downCount += 1;
        state.lastX = event.screenX;
        state.lastY = event.screenY;
      };
      const onPointerMove = (event) => {
        state.moveCount += 1;
        if (state.down && (event.buttons & 1) !== 0) state.dragMoveCount += 1;
        state.lastX = event.screenX;
        state.lastY = event.screenY;
      };
      const onPointerUp = (event) => {
        if (event.button !== 0) return;
        state.down = false;
        state.upCount += 1;
        state.lastX = event.screenX;
        state.lastY = event.screenY;
      };
      surface.addEventListener("pointerdown", onPointerDown);
      surface.addEventListener("pointermove", onPointerMove);
      surface.addEventListener("pointerup", onPointerUp);
      window.__ovuleDragE2e = {
        state,
        cleanup() {
          surface.removeEventListener("pointerdown", onPointerDown);
          surface.removeEventListener("pointermove", onPointerMove);
          surface.removeEventListener("pointerup", onPointerUp);
          surface.remove();
        },
      };

      const frameX = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
      const frameTop = Math.max(0, Math.round(window.outerHeight - window.innerHeight - frameX));
      const startClientX = Math.round(window.innerWidth * 0.35);
      const startClientY = Math.round(window.innerHeight * 0.45);
      const endClientX = Math.min(window.innerWidth - 48, startClientX + 240);
      const endClientY = Math.min(window.innerHeight - 48, startClientY + 160);
      const scale = window.devicePixelRatio || 1;
      return {
        start: {
          x: Math.round((window.screenX + frameX + startClientX) * scale),
          y: Math.round((window.screenY + frameTop + startClientY) * scale),
        },
        end: {
          x: Math.round((window.screenX + frameX + endClientX) * scale),
          y: Math.round((window.screenY + frameTop + endClientY) * scale),
        },
        scale,
      };
    });

    await hostPage.bringToFront();
    await focusHost(hostPage);
    // Windows does not emit a pointermove when absolute injection targets the
    // cursor's current position. Perturb first so repeated smoke runs with the
    // same window geometry still observe a real start-position transition.
    await sendChannelMessage(
      clientPage,
      "pointer",
      mouseEventMessage({ x: dragGeometry.end.x, y: dragGeometry.end.y }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(
      async () => {
        const positioned = await hostPage.evaluate(async ({ start, scale }) => {
          const state = window.__ovuleDragE2e.state;
          return Math.abs(state.lastX * scale - start.x) <= 8 &&
            Math.abs(state.lastY * scale - start.y) <= 8
            ? { ...state }
            : undefined;
        }, dragGeometry);
        if (positioned) return positioned;
        await sendChannelMessage(
          clientPage,
          "pointer",
          mouseEventMessage({ x: dragGeometry.start.x, y: dragGeometry.start.y }),
        );
        return undefined;
      },
      "direct CRD pointer positioning",
      timeoutMs,
      25,
    );

    await focusHost(hostPage);
    const dragDownStarted = performance.now();
    await sendChannelMessage(
      clientPage,
      "event",
      mouseEventMessage({
        x: dragGeometry.start.x,
        y: dragGeometry.start.y,
        button: 1,
        buttonDown: true,
      }),
    );
    await waitFor(
      () =>
        hostPage.evaluate(async () =>
          window.__ovuleDragE2e.state.downCount === 1
            ? { ...window.__ovuleDragE2e.state }
            : undefined,
        ),
      "CRD drag button down",
      timeoutMs,
      5,
    ).catch(async (error) => {
      diagnostics.push(
        `drag_down=${JSON.stringify(await hostPage.evaluate(async () => ({ ...window.__ovuleDragE2e.state, focused: document.hasFocus(), screenX: window.screenX, screenY: window.screenY, innerWidth: window.innerWidth, innerHeight: window.innerHeight })))}`,
      );
      diagnostics.push(
        `drag_down_channel=${JSON.stringify(await clientPage.evaluate(async () => ({ sequence: window.__ovuleRemoteControlE2e.inputSequence.toString(), state: window.__ovuleRemoteControlE2e.eventChannel.readyState, buffered: window.__ovuleRemoteControlE2e.eventChannel.bufferedAmount })))}`,
      );
      throw error;
    });
    const dragDownMs = Math.round(performance.now() - dragDownStarted);

    const firstDragPoint = {
      x: Math.round(dragGeometry.start.x + (dragGeometry.end.x - dragGeometry.start.x) / 12),
      y: Math.round(dragGeometry.start.y + (dragGeometry.end.y - dragGeometry.start.y) / 12),
    };
    const dragFirstMoveStarted = performance.now();
    await sendChannelMessage(clientPage, "event", mouseEventMessage(firstDragPoint));
    await waitFor(
      () =>
        hostPage.evaluate(async () =>
          window.__ovuleDragE2e.state.dragMoveCount > 0
            ? { ...window.__ovuleDragE2e.state }
            : undefined,
        ),
      "first low-latency CRD drag move",
      timeoutMs,
      5,
    );
    const dragFirstMoveMs = Math.round(performance.now() - dragFirstMoveStarted);

    const dragMoves = Array.from({ length: 12 }, (_, index) => {
      const progress = (index + 1) / 12;
      return mouseEventMessage({
        x: Math.round(firstDragPoint.x + (dragGeometry.end.x - firstDragPoint.x) * progress),
        y: Math.round(firstDragPoint.y + (dragGeometry.end.y - firstDragPoint.y) * progress),
      });
    });
    const dragSweepStarted = performance.now();
    await clientPage.evaluate(async (payloads) => {
      const value = window.__ovuleRemoteControlE2e;
      const channel = value.eventChannel;
      for (const payload of payloads) {
        const packet = new Uint8Array(8 + payload.length);
        new DataView(packet.buffer).setBigUint64(0, ++value.inputSequence, true);
        packet.set(payload, 8);
        channel.send(packet);
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
    }, dragMoves);
    const finalDragState = await waitFor(
      () =>
        hostPage.evaluate(async ({ end, scale }) => {
          const state = window.__ovuleDragE2e.state;
          return state.dragMoveCount >= 2 &&
            Math.abs(state.lastX * scale - end.x) <= 8 &&
            Math.abs(state.lastY * scale - end.y) <= 8
            ? { ...state }
            : undefined;
        }, dragGeometry),
      "final low-latency CRD drag position",
      timeoutMs,
      5,
    );
    const dragSweepMs = Math.round(performance.now() - dragSweepStarted);

    const dragUpStarted = performance.now();
    await sendChannelMessage(
      clientPage,
      "event",
      mouseEventMessage({
        x: dragGeometry.end.x,
        y: dragGeometry.end.y,
        button: 1,
        buttonDown: false,
      }),
    );
    await waitFor(
      () =>
        hostPage.evaluate(async () =>
          window.__ovuleDragE2e.state.upCount === 1 && !window.__ovuleDragE2e.state.down
            ? { ...window.__ovuleDragE2e.state }
            : undefined,
        ),
      "CRD drag button up",
      timeoutMs,
      5,
    );
    const dragUpMs = Math.round(performance.now() - dragUpStarted);
    process.stdout.write(
      `remote_control_drag=ok first_move_ms=${dragFirstMoveMs} up_ms=${dragUpMs}\n`,
    );
    assert.ok(dragFirstMoveMs < 250, `CRD first drag move took ${dragFirstMoveMs} ms`);
    assert.ok(dragUpMs < 250, `CRD drag button up took ${dragUpMs} ms`);

    const beforeStaleMove = await hostPage.evaluate(async () => ({
      ...window.__ovuleDragE2e.state,
    }));
    await sendChannelMessage(
      clientPage,
      "pointer",
      mouseEventMessage({ x: dragGeometry.start.x, y: dragGeometry.start.y }),
      "1",
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const afterStaleMove = await hostPage.evaluate(async () => ({
      ...window.__ovuleDragE2e.state,
    }));
    assert.equal(
      afterStaleMove.lastX,
      beforeStaleMove.lastX,
      "stale pointer packet moved the cursor backwards",
    );
    assert.equal(
      afterStaleMove.lastY,
      beforeStaleMove.lastY,
      "stale pointer packet moved the cursor backwards",
    );

    await focusHost(hostPage);
    await sendChannelMessage(
      clientPage,
      "event",
      mouseEventMessage({
        x: dragGeometry.start.x,
        y: dragGeometry.start.y,
        button: 1,
        buttonDown: true,
      }),
    );
    await waitFor(
      () =>
        hostPage.evaluate(async () =>
          window.__ovuleDragE2e.state.downCount === 2 && window.__ovuleDragE2e.state.down
            ? { ...window.__ovuleDragE2e.state }
            : undefined,
        ),
      "second CRD drag button down before disconnect",
      Math.min(timeoutMs, 15000),
      5,
    ).catch(async (error) => {
      diagnostics.push(
        `second_drag=${JSON.stringify(await hostPage.evaluate(async () => ({ ...window.__ovuleDragE2e.state, surfacePresent: !!document.querySelector("#ovule-crd-e2e-drag-surface"), screenX: window.screenX, screenY: window.screenY })))}`,
      );
      diagnostics.push(
        `second_drag_channel=${JSON.stringify(await clientPage.evaluate(async () => ({ sequence: window.__ovuleRemoteControlE2e.inputSequence.toString(), state: window.__ovuleRemoteControlE2e.eventChannel.readyState })))}`,
      );
      throw error;
    });
    const disconnectStarted = performance.now();
    await clientPage.evaluate(async () => window.__ovuleRemoteControlE2e.peer.close());
    await waitFor(
      () =>
        hostPage.evaluate(async () =>
          window.__ovuleDragE2e.state.upCount === 2 && !window.__ovuleDragE2e.state.down
            ? { ...window.__ovuleDragE2e.state }
            : undefined,
        ),
      "Host input release after the Client peer closes",
      timeoutMs,
      5,
    );
    const disconnectReleaseMs = Math.round(performance.now() - disconnectStarted);

    await clientPage.evaluate(async () => {
      const value = window.__ovuleRemoteControlE2e;
      clearInterval(value.heartbeat);
      await (await import("/shell_api.js")).remoting.stop(value.sessionId);
    });
    await waitFor(
      () =>
        clientPage.evaluate(async () => {
          const value = window.__ovuleRemoteControlE2e;
          let update;
          try {
            update = await (
              await import("/shell_api.js")
            ).remoting.snapshot(value.sessionId, value.afterSequence);
          } catch {
            return true;
          }
          if (update.state === "failed") throw new Error(update.error ?? "remote cleanup failed");
          return update.state === "stopped";
        }),
      "stopped remote session cleanup",
    );
    await clientPage.evaluate(async () => {
      window.__ovuleRemoteControlE2e.video.remove();
      delete window.__ovuleRemoteControlE2e;
    });
    await hostPage.evaluate(async () => {
      window.__ovuleDragE2e.cleanup();
      delete window.__ovuleDragE2e;
    });

    // Exercise the shipped React/controller path as well as the protocol fixture.
    const controllerUrl = new URL("/pane", clientPage.url());
    controllerUrl.searchParams.set("kind", "spice");
    controllerUrl.searchParams.set("tab", "remote-control-controller-e2e");
    controllerUrl.searchParams.set(
      "target",
      `remote-control-session:${encodeURIComponent(JSON.stringify({ endpointId: endpoint.endpointId, displayName: "Native controller smoke" }))}`,
    );
    await clientPage.goto(controllerUrl.href);
    assert.equal(
      await clientPage.locator('input[aria-label="STUN / TURN servers"]').count(),
      0,
      "Host-owned ICE configuration must not be exposed in the Remote Control UI",
    );
    await clientPage.waitForFunction(
      async () =>
        document.querySelector('[data-remote-control-session="connected"]') &&
        document.querySelector("video")?.videoWidth > 0,
      undefined,
      { timeout: timeoutMs },
    );
    await clientPage.evaluate(async () => {
      window.__ovuleControllerStream = document.querySelector("video").srcObject;
    });
    // The embedded pane receives actions from the registered outer pane toolbar.
    await clientPage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ovule:pane-command", {
          detail: { action: "remote.reconnect" },
        }),
      ),
    );
    await clientPage.waitForFunction(
      async () =>
        document.querySelector('[data-remote-control-session="connected"]') &&
        document.querySelector("video")?.srcObject &&
        document.querySelector("video").srcObject !== window.__ovuleControllerStream &&
        document.querySelector("video").videoWidth > 0,
      undefined,
      { timeout: timeoutMs },
    );
    assert.equal(
      await clientPage.locator("[data-remote-control-toolbar]").count(),
      0,
      "Embedded remote sessions must not duplicate their outer pane toolbar",
    );
    const layoutBeforeStats = await clientPage.evaluate(async () => {
      const frame = document.querySelector("[data-remote-control-frame]");
      const statusbar = document.querySelector("[data-remote-control-statusbar]");
      const video = document.querySelector("video");
      const frameBox = frame.getBoundingClientRect();
      const videoBox = video.getBoundingClientRect();
      return {
        frameWidth: Math.round(frameBox.width),
        frameHeight: Math.round(frameBox.height),
        videoX: Math.round(videoBox.x),
        videoY: Math.round(videoBox.y),
        videoWidth: Math.round(videoBox.width),
        videoHeight: Math.round(videoBox.height),
        sourceRatio: video.videoWidth / video.videoHeight,
        renderedRatio: videoBox.width / videoBox.height,
        statusbarHeight: Math.round(statusbar.getBoundingClientRect().height),
        statusbarOverflow: statusbar.scrollHeight > statusbar.clientHeight,
      };
    });
    assert.equal(layoutBeforeStats.statusbarHeight, 36);
    assert.equal(layoutBeforeStats.statusbarOverflow, false);
    assert.equal(
      await clientPage
        .locator("[data-remote-control-frame]")
        .evaluate(
          (frame) =>
            Math.abs(
              frame.getBoundingClientRect().top - frame.parentElement.getBoundingClientRect().top,
            ) < 1,
        ),
      true,
      "Remote video must start immediately below its outer pane toolbar",
    );
    await clientPage.getByRole("status", { name: /^Route (Direct|TURN)$/ }).waitFor();
    const visibleMetrics = await clientPage.locator("[data-remote-control-statusbar]").innerText();
    for (const title of ["FPS", "Latency", "Jitter", "Receive rate", "Loss"])
      assert.match(visibleMetrics, new RegExp(title), `${title} must be visible in the status bar`);
    assert.ok(
      Math.abs(layoutBeforeStats.sourceRatio - layoutBeforeStats.renderedRatio) < 0.02,
      JSON.stringify(layoutBeforeStats),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const layoutAfterStats = await clientPage.locator("video").boundingBox();
    assert.ok(layoutAfterStats);
    assert.ok(Math.abs(layoutAfterStats.x - layoutBeforeStats.videoX) <= 1);
    assert.ok(Math.abs(layoutAfterStats.y - layoutBeforeStats.videoY) <= 1);
    assert.ok(Math.abs(layoutAfterStats.width - layoutBeforeStats.videoWidth) <= 1);
    assert.ok(Math.abs(layoutAfterStats.height - layoutBeforeStats.videoHeight) <= 1);
    for (const name of ["Keyboard", "Mouse", "End-to-end Link"])
      await clientPage.getByRole("status", { name, exact: true }).waitFor();
    process.stdout.write(
      `remote_control_ui_layout=ok frame=${layoutBeforeStats.videoWidth}x${layoutBeforeStats.videoHeight} embedded_toolbar=none statusbar=36 stable_stats=true\n`,
    );
    await hostPage.bringToFront();
    await focusHost(hostPage);
    await hostPage.evaluate(async () => {
      const surface = document.createElement("div");
      surface.id = "controller-drag-target";
      surface.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:crosshair";
      window.__ovuleControllerDrag = {
        down: 0,
        moves: 0,
        up: 0,
        dragging: false,
        lastX: -1,
        lastY: -1,
      };
      surface.onpointerdown = (event) => {
        if (event.button !== 0) return;
        window.__ovuleControllerDrag.down++;
        window.__ovuleControllerDrag.dragging = true;
        window.__ovuleControllerDrag.lastX = event.screenX;
        window.__ovuleControllerDrag.lastY = event.screenY;
      };
      surface.onpointermove = (event) => {
        if (window.__ovuleControllerDrag.dragging && (event.buttons & 1) !== 0)
          window.__ovuleControllerDrag.moves++;
      };
      surface.onpointerup = (event) => {
        if (event.button !== 0) return;
        window.__ovuleControllerDrag.up++;
        window.__ovuleControllerDrag.dragging = false;
      };
      document.body.append(surface);
    });
    const controllerVideo = clientPage.locator("video");
    const controllerVideoBox = await controllerVideo.boundingBox();
    assert.ok(controllerVideoBox, "controller video has no interactive bounds");
    // Verify the native event's position, rather than only counting clicks.
    // This local fixture uses the default primary capture source. Host logical
    // screen coordinates determine fractions; Client DPI and decoded pixels do
    // not participate in that mapping.
    const geometry = await hostPage.evaluate(async () => {
      const border = Math.max(0, (outerWidth - innerWidth) / 2);
      const title = Math.max(0, outerHeight - innerHeight - border);
      return {
        width: screen.width,
        height: screen.height,
        targets: [0.15, 0.5, 0.85].flatMap((x) =>
          [0.15, 0.5, 0.85].map((y) => ({
            x: Math.round(screenX + border + innerWidth * x),
            y: Math.round(screenY + title + innerHeight * y),
          })),
        ),
      };
    });
    for (const [index, target] of geometry.targets.entries()) {
      assert.ok(
        target.x >= 0 && target.x < geometry.width && target.y >= 0 && target.y < geometry.height,
        "Pointer geometry fixture requires the Host window on the primary display",
      );
      await clientPage.mouse.click(
        controllerVideoBox.x + (controllerVideoBox.width * target.x) / geometry.width,
        controllerVideoBox.y + (controllerVideoBox.height * target.y) / geometry.height,
      );
      await waitFor(
        async () => {
          const state = await hostPage.evaluate(async () => ({ ...window.__ovuleControllerDrag }));
          if (state.down < index + 1 || state.up < index + 1) return undefined;
          assert.ok(
            Math.abs(state.lastX - target.x) <= 2 && Math.abs(state.lastY - target.y) <= 2,
            `Native pointer mismatch: expected=${JSON.stringify(target)} actual=${state.lastX},${state.lastY}`,
          );
          return state;
        },
        "native fractional pointer geometry",
        timeoutMs,
        5,
      );
    }
    await hostPage.evaluate(async () => {
      Object.assign(window.__ovuleControllerDrag, { down: 0, moves: 0, up: 0, dragging: false });
    });
    process.stdout.write(
      `remote_control_ui_pointer_geometry=ok targets=9 host_logical_screen=${geometry.width}x${geometry.height} tolerance=2\n`,
    );
    const dragStart = {
      x: controllerVideoBox.x + controllerVideoBox.width * 0.35,
      y: controllerVideoBox.y + controllerVideoBox.height * 0.4,
    };
    await clientPage.mouse.move(dragStart.x, dragStart.y);
    await clientPage.mouse.down();
    await clientPage.mouse.move(dragStart.x + 180, dragStart.y + 120, { steps: 8 });
    await clientPage.mouse.up();
    await waitFor(
      () =>
        hostPage.evaluate(async () => {
          const value = window.__ovuleControllerDrag;
          return value.down === 1 && value.moves > 0 && value.up === 1 && !value.dragging
            ? { ...value }
            : undefined;
        }),
      "drag through the shipped SessionController UI",
      timeoutMs,
      5,
    );
    process.stdout.write("remote_control_ui_drag=ok down=true move=true up=true\n");
    await hostPage.evaluate(async () => {
      const input = document.createElement("textarea");
      input.id = "controller-key-target";
      input.style.cssText = "position:fixed;inset:40px;z-index:2147483647";
      window.__ovuleControllerKeys = 0;
      input.onkeyup = (event) => {
        if (event.code === "ShiftLeft") window.__ovuleControllerKeys++;
      };
      document.body.append(input);
      input.focus();
    });
    await waitFor(
      () =>
        hostPage.evaluate(
          async () => document.hasFocus() && document.activeElement?.id === "controller-key-target",
        ),
      "focused Host controller target",
    );
    await clientPage.evaluate(async () => {
      const input = document.querySelector('textarea[aria-label="Remote desktop keyboard input"]');
      if (!input) throw new Error("controller keyboard surface is missing");
      for (const type of ["keydown", "keyup"])
        input.dispatchEvent(
          new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            code: "ShiftLeft",
            key: "Shift",
          }),
        );
    });
    await waitFor(
      () => hostPage.evaluate(async () => window.__ovuleControllerKeys === 1),
      "keyboard through the shipped SessionController",
      timeoutMs,
      5,
    );
    // Click within existing text, then reproduce a first non-composing pinyin
    // keydown followed by an IME commit through the actual React input surface.
    const caretTarget = await hostPage.evaluate(async () => {
      const input = document.querySelector("#controller-key-target");
      input.style.cssText =
        "position:fixed;left:80px;top:100px;width:500px;height:100px;z-index:2147483647;font:24px monospace;padding:0;border:0;line-height:32px";
      input.value = "abcdef";
      input.focus();
      input.setSelectionRange(6, 6);
      const context = document.createElement("canvas").getContext("2d");
      const font = getComputedStyle(input);
      context.font = `${font.fontSize} ${font.fontFamily}`;
      const bounds = input.getBoundingClientRect();
      const border = Math.max(0, (outerWidth - innerWidth) / 2);
      const title = Math.max(0, outerHeight - innerHeight - border);
      return {
        x: screenX + border + bounds.left + context.measureText("abc").width,
        y: screenY + title + bounds.top + 16,
      };
    });
    await clientPage.mouse.click(
      controllerVideoBox.x + (controllerVideoBox.width * caretTarget.x) / geometry.width,
      controllerVideoBox.y + (controllerVideoBox.height * caretTarget.y) / geometry.height,
    );
    await waitFor(
      () =>
        hostPage.evaluate(async () => {
          const input = document.querySelector("#controller-key-target");
          return (
            document.activeElement === input &&
            input.selectionStart === 3 &&
            input.selectionEnd === 3
          );
        }),
      "remote click places the text caret",
      timeoutMs,
      10,
    );
    await clientPage.evaluate(async () => {
      const input = document.querySelector('textarea[aria-label="Remote desktop keyboard input"]');
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "y", code: "KeyY", bubbles: true, cancelable: true }),
      );
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = "yuancheng";
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          isComposing: true,
          inputType: "insertCompositionText",
          data: "yuancheng",
        }),
      );
      input.value = "远程";
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "远程" }));
      input.value = "远程";
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertFromComposition",
          data: "远程",
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keyup", { key: "y", code: "KeyY", bubbles: true, cancelable: true }),
      );
    });
    await waitFor(
      () =>
        hostPage.evaluate(
          async () => document.querySelector("#controller-key-target").value === "abc远程def",
        ),
      "IME inserts once at the clicked caret without the first pinyin letter",
      timeoutMs,
      10,
    );
    process.stdout.write(
      "remote_control_ui_ime_caret=ok first_key_local=true chinese_commit_once=true click_selection=true\n",
    );
    await hostPage.evaluate(async () => {
      document.querySelector("#controller-key-target")?.remove();
      document.querySelector("#controller-drag-target")?.remove();
      delete window.__ovuleControllerKeys;
      delete window.__ovuleControllerDrag;
    });
    // This isolated Host has no TURN configuration: forcing TURN must fail
    // explicitly, then switching back to automatic must restore the session.
    await clientPage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ovule:pane-command", {
          detail: { action: "remote.mode:relay" },
        }),
      ),
    );
    await clientPage.waitForFunction(
      async () =>
        document.querySelector('[data-remote-control-session="error"]') &&
        document.querySelector("details")?.textContent.includes("TURN-only mode requires"),
      undefined,
      { timeout: timeoutMs },
    );
    await clientPage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ovule:pane-command", {
          detail: { action: "remote.mode:all" },
        }),
      ),
    );
    await clientPage.waitForFunction(
      async () =>
        document.querySelector('[data-remote-control-session="connected"]') &&
        document.querySelector("video")?.videoWidth > 0,
      undefined,
      { timeout: timeoutMs },
    );
    await clientPage.getByRole("status", { name: "Route Direct", exact: true }).waitFor();
    process.stdout.write(
      "remote_control_ui_route=ok selected_route_visible=true missing_turn_fails=true automatic_recovers=true\n",
    );
    await clientPage.goto(new URL("/main", clientPage.url()).href);
    process.stdout.write(
      "remote_control_ui_controller=ok first_frame=true reconnect=true native_keyboard=true host_owned_ice=true\n",
    );

    process.stdout.write(
      `remote_control_dual_instance_e2e=ok separate_apps=true link_pairing=true initial_signal_cursor=true sdp=true ice=true control_channel=true event_channel=true pointer_channel=unreliable-unordered direct_event_channel=true text_input=true text_input_ms=${inputLatencyMs} drag=true drag_down_ms=${dragDownMs} drag_first_move_ms=${dragFirstMoveMs} drag_sweep_ms=${dragSweepMs} drag_up_ms=${dragUpMs} drag_moves=${finalDragState.dragMoveCount} disconnect_release=true disconnect_release_ms=${disconnectReleaseMs} video_track=true decoded_frame=${connected.videoWidth}x${connected.videoHeight} stats=true stop=true session_removed=true\n`,
    );
  }
} catch (error) {
  if (clientPage && !clientPage.isClosed()) {
    const state = await clientPage
      .evaluate(async () => {
        const value = window.__ovuleRemoteControlE2e;
        if (!value) return { phase: "before-session" };
        const reports = [...(await value.peer.getStats()).values()];
        const counts = (type) =>
          reports
            .filter((report) => report.type === type)
            .reduce((result, report) => {
              const key = report.candidateType ?? report.state ?? "unknown";
              result[key] = (result[key] ?? 0) + 1;
              return result;
            }, {});
        return {
          connection: value.peer.connectionState,
          ice: value.peer.iceConnectionState,
          gathering: value.peer.iceGatheringState,
          signals: value.signalCount,
          localCandidates: counts("local-candidate"),
          remoteCandidates: counts("remote-candidate"),
          pairs: counts("candidate-pair"),
          iceErrors: value.iceErrors,
          decodedFrames:
            reports.find((report) => report.type === "inbound-rtp" && report.kind === "video")
              ?.framesDecoded ?? 0,
        };
      })
      .catch(() => ({ phase: "diagnostics-unavailable" }));
    process.stderr.write(`remote_control_diagnostics=${JSON.stringify(state)}\n`);
  }
  if (diagnostics.length) process.stderr.write(`${diagnostics.join("\n")}\n`);
  throw error;
} finally {
  if (clientPage && !clientPage.isClosed()) {
    await clientPage
      .evaluate(async () => {
        const value = window.__ovuleRemoteControlE2e;
        if (!value) return;
        clearInterval(value.heartbeat);
        value.peer.close();
        value.video.remove();
        await (await import("/shell_api.js")).remoting.stop(value.sessionId).catch(() => undefined);
        delete window.__ovuleRemoteControlE2e;
      })
      .catch(() => undefined);
  }
  await Promise.all([
    hostBrowser?.close().catch(() => undefined),
    clientBrowser?.close().catch(() => undefined),
  ]);
}
