/** Host-owned frame capability. Generated scripts never execute in either UI realm. */
export function mountInteractiveFrame(
  container: HTMLElement,
  value: { title?: unknown; html?: unknown },
  onCompose: (prompt: string) => void,
): () => void {
  if (typeof value.html !== "string" || value.html.length > 128 * 1024)
    throw new Error("Interactive content is unavailable");
  const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || "ovule-spa";
  const content = document.createElement("template");
  content.innerHTML = value.html;
  content.content.querySelectorAll("script").forEach((script) => {
    script.removeAttribute("src");
    script.setAttribute("nonce", nonce);
  });
  content.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes])
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
  });
  const frame = document.createElement("iframe");
  frame.title = typeof value.title === "string" ? value.title.slice(0, 256) : "Interactive card";
  frame.sandbox.add("allow-scripts");
  frame.referrerPolicy = "no-referrer";
  frame.style.cssText = "width:100%;height:360px;border:0;border-radius:10px;background:white";
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:14px system-ui;margin:16px;color:#171717}button,input,select,textarea{font:inherit}button{cursor:pointer}</style><script nonce="${nonce}">window.ovule=Object.freeze({compose(prompt){parent.postMessage({type:'ovule:compose',prompt},'*')}});document.addEventListener('submit',event=>event.preventDefault());document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault()});</script></head><body>${content.innerHTML}</body></html>`;
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.type !== "ovule:compose") return;
    const prompt = event.data.prompt;
    if (typeof prompt === "string" && prompt.trim() && prompt.length <= 16384) onCompose(prompt);
  };
  window.addEventListener("message", receive);
  container.replaceChildren(frame);
  return () => {
    window.removeEventListener("message", receive);
    frame.remove();
  };
}
