using System;
using System.Threading;
public static class FakeOllama {
  public static int Main(string[] args) {
    if (args.Length == 1 && args[0] == "--version") {
      Console.WriteLine("ollama version is 0.34.0");
      return 0;
    }
    if (args.Length > 0 && args[0] == "pull") {
      Console.WriteLine("pulling manifest");
      Console.WriteLine("success");
      return 0;
    }
    if (args.Length > 0 && args[0] == "run") {
      Console.WriteLine("# Ollama local response");
      Thread.Sleep(120);
      Console.WriteLine();
      Console.WriteLine("**OLLAMA_CDP_OK**");
      return 0;
    }
    return 2;
  }
}
