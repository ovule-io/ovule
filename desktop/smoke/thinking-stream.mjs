import assert from "node:assert/strict";
import path from "node:path";

export async function smokeThinkingStream(guest, app, threadId, root, waitFor) {
  await guest(
    `(await import("/shell_api.js")).message.sendMessage(${JSON.stringify(threadId)}, 'THINKING_STREAM_SMOKE').then(()=>true)`,
  );
  const thought = `document.querySelector('[data-message-status="streaming"] details')`;
  await waitFor(
    () => guest(`Boolean(${thought}?.textContent.includes('Step'))`),
    "Thinking starts",
  );
  const deadline = Date.now() + 35_000;
  let queries = 0;
  let maxLatency = 0;
  while (Date.now() < deadline) {
    const start = Date.now();
    await guest(
      `Promise.all([(await import("/shell_api.js")).workspace.snapshot(),(await import("/shell_api.js")).extensions.extensionCatalog()]).then(()=>true)`,
    );
    maxLatency = Math.max(maxLatency, Date.now() - start);
    queries++;
    assert.ok(maxLatency < 5000, `ShellAPI stalled during thinking: ${maxLatency}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const layout = await guest(`(() => {
    const details=${thought}; const text=details?.querySelector('div');
    const viewport=document.querySelector('.ui-message-scroller-viewport');
    return {open: details?.open, height: text?.clientHeight, scrollHeight: text?.scrollHeight,
      maxHeight: text && getComputedStyle(text).maxHeight,
      distance: viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop};
  })()`);
  assert.equal(layout.open, true);
  assert.equal(layout.maxHeight, "none");
  assert.ok(layout.height > 240, JSON.stringify(layout));
  assert.ok(layout.scrollHeight - layout.height < 2, JSON.stringify(layout));
  assert.ok(layout.distance < 80, `Streaming must follow latest: ${JSON.stringify(layout)}`);
  await guest(
    `(() => {const v=document.querySelector('.ui-message-scroller-viewport');v.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));v.scrollTop=0;})()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.ok(
    await guest(`document.querySelector('.ui-message-scroller-viewport').scrollTop < 100`),
    "Reading older output must stop following",
  );
  await guest(`document.querySelector('button[aria-label="Jump to latest message"]')?.click()`);
  await app.screenshot({ path: path.join(root, "thinking-stream.png") });
  await waitFor(
    () => guest(`!document.querySelector('[data-message-status="streaming"]')`),
    "Thinking completes",
    20000,
  );
  assert.equal(
    await guest(`document.querySelector('[data-message-role="assistant"] details')?.open`),
    false,
  );
  await guest(`(() => {
    window.__originalSmokeInvoke = tuffite.invoke;
    tuffite.invoke = (channel,payload) => {
      if (channel.endsWith('.sendMessage')) return Promise.reject(new Error('SMOKE_TRANSPORT_FAILURE'));
      return window.__originalSmokeInvoke.call(tuffite,channel,payload);
    };
    if (tuffite.invoke === window.__originalSmokeInvoke) throw new Error('Could not install isolated transport failure');
    const input=document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Footer error regression');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await waitFor(
    () => guest(`!document.querySelector('button[aria-label="Send message"]').disabled`),
    "Composer receives failed-send draft",
  );
  await guest(`document.querySelector('button[aria-label="Send message"]').click()`);
  await waitFor(
    () =>
      guest(
        `Boolean(document.querySelector('.message-card footer [role="alert"]')?.textContent.includes('SMOKE_TRANSPORT_FAILURE'))`,
      ),
    "Error belongs to message footer",
  );
  assert.ok(
    await guest(`(() => {
    const error=document.querySelector('.message-card footer [role="alert"]');
    const card=error.closest('.message-card');
    return error.getBoundingClientRect().width <= card.getBoundingClientRect().width;
  })()`),
  );
  await app.screenshot({ path: path.join(root, "thinking-error-footer.png") });
  await guest(`tuffite.invoke=window.__originalSmokeInvoke; true`);
  console.log(
    `core_native_smoke=thinking-stream-35s-responsive-follow-scroll-collapse-error-footer queries=${queries} maxLatencyMs=${maxLatency}`,
  );
}
