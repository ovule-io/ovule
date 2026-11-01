using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

public static class FakeAcpAgent {
  private static string mcpUrl;
  private static string mcpAuthorization;
  private static string mcpSessionId;

  public static int Main(string[] args) {
    var executable = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]);
    if (!String.Equals(executable, "codex-acp", StringComparison.OrdinalIgnoreCase)
        && Array.IndexOf(args, "acp") < 0) {
      Console.WriteLine("[]");
      return 0;
    }
    string line;
    while ((line = Console.ReadLine()) != null) {
      var id = RequestId(line);
      if (line.Contains("\"method\":\"initialize\"")) {
        Write("{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"result\":{\"protocolVersion\":1,\"agentCapabilities\":{\"mcpCapabilities\":{\"http\":true,\"sse\":false}}}}");
      } else if (line.Contains("\"method\":\"session/new\"")) {
        CaptureComputerUseMcp(line);
        Write("{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"result\":{\"sessionId\":\"fake-session\"}}");
      } else if (line.Contains("\"method\":\"session/prompt\"")) {
        var structured = line.IndexOf("Return only a JSON object", StringComparison.Ordinal) >= 0;
        var output = line.IndexOf("CRD_EXTERNAL_MCP_CDP", StringComparison.Ordinal) >= 0
          ? VerifyComputerUseMcp()
          : Response(line, structured);
        foreach (var delta in Chunks(output)) {
          Write("{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{\"sessionId\":\"fake-session\",\"update\":{\"sessionUpdate\":\"agent_message_chunk\",\"content\":{\"type\":\"text\",\"text\":\"" + Escape(delta) + "\"}}}}");
          // Keep the deterministic stream open long enough for the first
          // message to recreate its Thread Explorer target and attach UI
          // observers before the final chunks arrive.
          System.Threading.Thread.Sleep(350);
        }
        Write("{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"result\":{\"stopReason\":\"end_turn\"}}");
      }
    }
    return 0;
  }

  private static void CaptureComputerUseMcp(string request) {
    var url = Regex.Match(
      request,
      "\\\"url\\\"\\s*:\\s*\\\"(?<value>http://127\\.0\\.0\\.1:[0-9]+/mcp)\\\""
    );
    var authorization = Regex.Match(
      request,
      "\\\"name\\\"\\s*:\\s*\\\"Authorization\\\"\\s*,\\s*\\\"value\\\"\\s*:\\s*\\\"(?<value>Bearer [^\\\"]+)\\\""
    );
    mcpUrl = url.Success ? url.Groups["value"].Value : null;
    mcpAuthorization = authorization.Success ? authorization.Groups["value"].Value : null;
    mcpSessionId = null;
  }

  private static string VerifyComputerUseMcp() {
    if (String.IsNullOrWhiteSpace(mcpUrl) || String.IsNullOrWhiteSpace(mcpAuthorization))
      return "CRD_EXTERNAL_MCP_CDP_FAILED missing authenticated MCP projection";
    try {
      var initialized = PostMcp(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"ovule-native-smoke\",\"version\":\"1.0\"}}}"
      );
      if (initialized.IndexOf("protocolVersion", StringComparison.Ordinal) < 0)
        throw new InvalidOperationException("MCP initialize response is invalid");
      PostMcp("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\",\"params\":{}}");
      var tools = PostMcp("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}");
      if (tools.IndexOf("ovule_computer_control", StringComparison.Ordinal) < 0)
        throw new InvalidOperationException("Computer Use tool is absent from tools/list");
      var screenshot = PostMcp(
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"ovule_computer_control\",\"arguments\":{\"action\":\"screenshot\"}}}"
      );
      if (screenshot.IndexOf("\"type\":\"image\"", StringComparison.Ordinal) < 0 ||
          screenshot.IndexOf("Captured ", StringComparison.Ordinal) < 0)
        throw new InvalidOperationException(
          "Computer Use screenshot did not return image content: " + SanitizeMcpResponse(screenshot)
        );
      return "ACP_CRD_MCP_CDP_OK";
    } catch (Exception error) {
      return "CRD_EXTERNAL_MCP_CDP_FAILED " + error.GetType().Name + ": " + error.Message;
    }
  }

  private static string PostMcp(string payload) {
    var request = (HttpWebRequest)WebRequest.Create(mcpUrl);
    request.Method = "POST";
    request.ContentType = "application/json";
    request.Accept = "application/json, text/event-stream";
    request.Headers["Authorization"] = mcpAuthorization;
    if (!String.IsNullOrWhiteSpace(mcpSessionId))
      request.Headers["Mcp-Session-Id"] = mcpSessionId;
    var bytes = Encoding.UTF8.GetBytes(payload);
    request.ContentLength = bytes.Length;
    using (var stream = request.GetRequestStream())
      stream.Write(bytes, 0, bytes.Length);
    using (var response = (HttpWebResponse)request.GetResponse()) {
      var sessionId = response.Headers["Mcp-Session-Id"];
      if (!String.IsNullOrWhiteSpace(sessionId)) mcpSessionId = sessionId;
      using (var reader = new StreamReader(response.GetResponseStream()))
        return reader.ReadToEnd();
    }
  }

  private static string SanitizeMcpResponse(string response) {
    if (String.IsNullOrWhiteSpace(response)) return "<empty response>";
    var sanitized = Regex.Replace(
      response,
      "(\\\"data\\\"\\s*:\\s*\\\")[^\\\"]+(\\\")",
      "$1<redacted>$2"
    );
    return sanitized.Length <= 2000 ? sanitized : sanitized.Substring(0, 2000) + "...";
  }

  private static string Response(string prompt, bool structured) {
    if (structured) {
      if (prompt.IndexOf("Dynamically replan", StringComparison.OrdinalIgnoreCase) >= 0) {
        if (prompt.IndexOf("channel", StringComparison.OrdinalIgnoreCase) >= 0)
          return "{\"title\":\"Configure Channel channel\",\"intent\":\"Connect and verify the Channel channel.\",\"response\":\"Channel Workflow dynamically replanned.\",\"nodes\":[]}";
        if (prompt.IndexOf("WORKFLOW_CDP_OK", StringComparison.Ordinal) >= 0)
          return "{\"title\":\"CDP Goal\",\"intent\":\"Return the exact marker WORKFLOW_CDP_OK without modifying files.\",\"response\":\"Workflow dynamically replanned after verified execution.\",\"nodes\":[]}";
        return "{\"title\":\"CDP setup\",\"intent\":\"Complete setup with verification.\",\"response\":\"Setup Workflow dynamically replanned.\",\"nodes\":[]}";
      }
      if (prompt.IndexOf("Goal request", StringComparison.OrdinalIgnoreCase) >= 0
          && prompt.IndexOf("WORKFLOW_CDP_OK", StringComparison.Ordinal) >= 0)
        return "{\"title\":\"CDP Goal\",\"intent\":\"Return the exact marker WORKFLOW_CDP_OK without modifying files.\",\"response\":\"Goal and Workflow created.\",\"nodes\":[{\"kind\":\"task\",\"title\":\"Return exactly WORKFLOW_CDP_OK without modifying files\"},{\"kind\":\"gate\",\"title\":\"Approve release\"}]}";
      if (prompt.IndexOf("配置 channel bot", StringComparison.OrdinalIgnoreCase) >= 0)
        return "I can help configure the Channel channel bot.";
      var channel = prompt.IndexOf("channel", StringComparison.OrdinalIgnoreCase) >= 0
        || prompt.IndexOf("global", StringComparison.OrdinalIgnoreCase) >= 0;
      return channel
        ? "{\"title\":\"Configure Channel channel\",\"intent\":\"Connect and verify the Channel channel.\",\"response\":\"Channel setup workflow created.\",\"nodes\":[{\"kind\":\"task\",\"title\":\"Inspect the existing Ovule app registration\"},{\"kind\":\"gate\",\"title\":\"Complete browser authorization\"}]}"
        : "{\"title\":\"CDP setup\",\"intent\":\"Complete setup with verification.\",\"response\":\"Setup workflow created.\",\"nodes\":[{\"kind\":\"task\",\"title\":\"Verify prerequisites\"}]}";
    }
    if (prompt.IndexOf("ECHARTS_CDP_OK", StringComparison.Ordinal) >= 0) {
      return "Chart rendered.\n\n```ovule-block\n{\"id\":\"echarts-cdp\",\"kind\":\"echarts\",\"data\":{\"option\":{\"title\":{\"text\":\"ECHARTS_CDP_OK\"},\"xAxis\":{\"type\":\"category\",\"data\":[\"A\",\"B\"]},\"yAxis\":{\"type\":\"value\"},\"series\":[{\"type\":\"bar\",\"data\":[1,2]}]}}}\n```";
    }
    if (prompt.IndexOf("WORKFLOW_CDP_OK", StringComparison.Ordinal) >= 0)
      return "WORKFLOW_CDP_OK";
    if (prompt.IndexOf("CHANNEL_AGENT_ROUND_TRIP_OK", StringComparison.Ordinal) >= 0)
      return "CHANNEL_AGENT_ROUND_TRIP_OK";
    if (prompt.IndexOf("OFFICE_FILE_PATH_CDP", StringComparison.Ordinal) >= 0)
      return "Generated PDF: " + Environment.GetEnvironmentVariable("OVULE_CDP_OUTSIDE_PDF");
    return "# CDP production thread\n\n- Streaming Markdown frame one.\n- Streaming Markdown frame two.\n\nTHREAD_CDP_OK";
  }

  private static IEnumerable<string> Chunks(string value) {
    var size = Math.Max(1, value.Length / 4);
    for (var index = 0; index < value.Length; index += size)
      yield return value.Substring(index, Math.Min(size, value.Length - index));
  }

  private static string Escape(string value) {
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
  }

  private static string RequestId(string value) {
    var match = Regex.Match(value, "\"id\"\\s*:\\s*(\"(?:[^\"]|\\\\.)*\"|-?[0-9]+)");
    return match.Success ? match.Groups[1].Value : "null";
  }

  private static void Write(string json) {
    Console.WriteLine(json);
    Console.Out.Flush();
  }
}
