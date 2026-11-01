export function webUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("URL is required");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Only HTTP(S) URLs without credentials are supported");
  return url.href;
}
/** One isolated-world snapshot generation. Page scripts cannot mutate the ref map. */
export function snapshotScript(generation: number) {
  return `(() => {
    const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')].filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0}).slice(0,200);
    const refs = new Map();
    const elements = nodes.map((node,index)=>{const ref=${JSON.stringify(String(generation))}+':'+index;refs.set(ref,node);return {ref,role:node.getAttribute('role')||node.tagName.toLowerCase(),label:(node.getAttribute('aria-label')||node.innerText||node.getAttribute('placeholder')||'').slice(0,200),disabled:!!node.disabled};});
    globalThis.__ovuleBrowserRefs={generation:${generation},refs};
    return {url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,12000),elements,method:'dom'};
  })()`;
}
export function actionScript(generation: number, args: Record<string, unknown>) {
  const action = args.action;
  if (action === "scroll") {
    const delta = Number(args.deltaY);
    if (!Number.isFinite(delta) || Math.abs(delta) > 10000)
      throw new Error("deltaY must be finite and bounded to 10000 CSS pixels");
    return `(() => {window.scrollBy(0,${delta});return {method:'dom',scrolled:true};})()`;
  }
  if (action !== "click" && action !== "type") throw new Error("Unsupported Browser input action");
  if (typeof args.ref !== "string" || args.ref.split(":")[0] !== String(generation))
    throw new Error("Stale element reference; request a fresh snapshot");
  if (action === "type" && (typeof args.text !== "string" || args.text.length > 16000))
    throw new Error("Browser text must be bounded to 16000 characters");
  return `(() => {
    const snapshot=globalThis.__ovuleBrowserRefs;
    if(!snapshot||snapshot.generation!==${generation}) throw new Error('Stale snapshot');
    const node=snapshot.refs.get(${JSON.stringify(args.ref)});
    if(!node||!node.isConnected||node.disabled) throw new Error('Element is unavailable; take a fresh snapshot');
    node.scrollIntoView({block:'center',inline:'nearest'});const r=node.getBoundingClientRect();
    const point={x:r.left+r.width/2,y:r.top+r.height/2};
    ${action === "click" ? "node.click();" : `if(node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement){node.focus();const proto=node instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${JSON.stringify(args.text)});node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));}else if(node.isContentEditable){node.focus();node.textContent=${JSON.stringify(args.text)};node.dispatchEvent(new Event('input',{bubbles:true}));}else throw new Error('Element is not editable');`}
    return {method:'dom',...point};
  })()`;
}
