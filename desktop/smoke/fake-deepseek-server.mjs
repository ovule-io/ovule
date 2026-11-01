import http from "node:http";

const port = Number(process.env.OVULE_FAKE_DEEPSEEK_PORT ?? "11436");
const expectedAuthorization = "Bearer sk-deepseek-native-smoke-1234567890";
const collectBody = async (request) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16 * 1024 * 1024) throw new Error("request too large");
  }
  return JSON.parse(body);
};
const server = http.createServer((request, response) => {
  process.stdout.write(`fake_deepseek_request=${request.method} ${request.url}\n`);
  if (request.method === "GET" && request.url === "/channel-launcher") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Channel launcher</title><p>Launching Channel authorization...</p><script>location.replace('/channel-authorized')<\/script>",
    );
    return;
  }
  if (request.method === "GET" && request.url === "/channel-authorized") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Channel authorization</title><h1>CHANNEL_LAUNCHER_CDP_OK</h1>",
    );
    return;
  }
  if (request.method === "GET" && request.url === "/browser-fail") {
    request.socket.destroy();
    return;
  }
  if (request.method === "GET" && request.url === "/models") {
    if (request.headers.authorization !== expectedAuthorization) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "invalid API key" } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "deepseek-flash", object: "model", owned_by: "deepseek" },
          { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
          { id: "deepseek-v4-special", object: "model", owned_by: "deepseek" },
        ],
      }),
    );
    return;
  }
  if (request.method === "POST" && request.url === "/chat/completions") {
    if (request.headers.authorization !== expectedAuthorization) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "invalid API key" } }));
      return;
    }
    void collectBody(request)
      .then(async (body) => {
        if (!["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-special"].includes(body.model)) {
          throw new Error(`unexpected DeepSeek model: ${String(body.model)}`);
        }
        const prompt = body.messages?.at(-1)?.content ?? "";
        const structured = body.response_format?.type === "json_object";
        const computerTool = body.tools?.find(
          (tool) =>
            tool.function?.name === "ovule_computer_control" ||
            tool.function?.name?.startsWith("mcp_"),
        );
        const hasToolResult = body.messages?.some((message) => message.role === "tool");
        const thinkingStream = prompt.includes("THINKING_STREAM_SMOKE");
        const useComputerTool = !thinkingStream && !structured && computerTool && !hasToolResult;
        const content = structured
          ? JSON.stringify({
              title: "Channel feedback setup",
              intent: "Configure and verify the requested Channel feedback workflow.",
              response: "I created the Channel feedback workflow.",
              nodes: [
                { kind: "task", title: "Inspect current Channel connection status" },
                { kind: "gate", title: "Approve Channel authorization" },
              ],
            })
          : hasToolResult
            ? "DEEPSEEK_NATIVE_CDP_OK CRD_COMPUTER_USE_CDP_OK"
            : prompt.includes("DEEPSEEK_NATIVE_CDP")
              ? "DEEPSEEK_NATIVE_CDP_OK"
              : "DeepSeek native provider response";
        if (body.stream) {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          });
          if (thinkingStream) {
            for (let step = 0; step < 400; step++) {
              if (response.destroyed) return;
              // Many small provider tokens, lasting longer than the native 30s deadline.
              for (let token = 0; token < 10; token++) {
                response.write(
                  `data: ${JSON.stringify({
                    id: "thinking-smoke",
                    object: "chat.completion.chunk",
                    created: 1,
                    model: body.model,
                    choices: [
                      {
                        index: 0,
                        delta: { reasoning_content: `Step ${step}.${token}\n` },
                        finish_reason: null,
                      },
                    ],
                  })}\n\n`,
                );
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
          if (useComputerTool) {
            response.write(
              `data: ${JSON.stringify({
                id: "deepseek-smoke",
                object: "chat.completion.chunk",
                created: 1,
                model: body.model ?? "deepseek-flash",
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call-crd-computer-use-deepseek",
                          type: "function",
                          function: {
                            name: computerTool.function.name,
                            arguments: JSON.stringify({ action: "screenshot" }),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            );
          } else {
            for (const delta of [content.slice(0, 10), content.slice(10)]) {
              if (!delta) continue;
              response.write(
                `data: ${JSON.stringify({
                  id: "deepseek-smoke",
                  object: "chat.completion.chunk",
                  created: 1,
                  model: body.model ?? "deepseek-flash",
                  choices: [
                    {
                      index: 0,
                      delta: { content: delta },
                      finish_reason: null,
                    },
                  ],
                })}\n\n`,
              );
            }
          }
          response.write(
            `data: ${JSON.stringify({
              id: "deepseek-smoke",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model ?? "deepseek-flash",
              choices: [
                { index: 0, delta: {}, finish_reason: useComputerTool ? "tool_calls" : "stop" },
              ],
            })}\n\n`,
          );
          response.end("data: [DONE]\n\n");
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "deepseek-smoke",
            object: "chat.completion",
            created: 1,
            model: body.model ?? "deepseek-flash",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      })
      .catch((error) => {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message: "not found" } }));
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`fake_deepseek_ready=${port}\n`));
