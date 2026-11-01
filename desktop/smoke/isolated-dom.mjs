/** CDP can inspect closed shadow roots; application code intentionally cannot. */
const sessions = new WeakMap();
async function session(page) {
  if (!sessions.has(page)) sessions.set(page, await page.context().newCDPSession(page));
  return sessions.get(page);
}
function children(node) {
  return [
    ...(node.children ?? []),
    ...(node.shadowRoots ?? []),
    ...(node.contentDocument ? [node.contentDocument] : []),
  ];
}
function flatten(node) {
  return [node, ...children(node).flatMap(flatten)];
}
function attributes(node) {
  return Object.fromEntries(
    Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, i) => [
      node.attributes[i * 2],
      node.attributes[i * 2 + 1],
    ]),
  );
}
function text(node) {
  return node.nodeType === 3 ? node.nodeValue : children(node).map(text).join("");
}
export async function closedNodes(page, scope, predicate) {
  const cdp = await session(page);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const host = flatten(root).find((node) => {
    const attrs = attributes(node);
    return scope.id ? attrs.id === scope.id : attrs["data-isolated-world"] === scope.extensionId;
  });
  return host
    ? flatten(host).filter((node) =>
        predicate({ tag: node.localName, attributes: attributes(node), text: text(node) }),
      )
    : [];
}
export async function callClosed(page, node, functionDeclaration, args = []) {
  const cdp = await session(page);
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node.backendNodeId });
  try {
    const result = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text + ": " + result.exceptionDetails.exception?.description,
      );
    return result.result.value;
  } finally {
    await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
  }
}
export async function clickClosed(page, scope, label) {
  const nodes = await closedNodes(
    page,
    scope,
    (node) => node.tag === "button" && node.text.trim() === label,
  );
  if (!nodes.length) throw new Error(`Missing isolated button: ${label}`);
  return callClosed(
    page,
    nodes[0],
    "function(){if(this.disabled)throw new Error('Button disabled');this.click();}",
  );
}
export async function fillClosed(page, scope, label, value) {
  const nodes = await closedNodes(
    page,
    scope,
    (node) => node.tag === "input" && node.attributes["aria-label"] === label,
  );
  if (!nodes.length) throw new Error(`Missing isolated input: ${label}`);
  return callClosed(
    page,
    nodes[0],
    "function(value){this.value=value;this.dispatchEvent(new Event('input',{bubbles:true}));}",
    [value],
  );
}
