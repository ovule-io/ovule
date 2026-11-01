/** Short actionable messages; internal diagnostics remain available separately. */
export function connectionErrorKey(error: string): string {
  if (/relay service unavailable|Connection service/i.test(error))
    return "spice.connectionRelayUnavailable";
  if (/no TURN relay|requires a TURN relay|TURN-only mode requires/i.test(error))
    return "spice.connectionRelaySetup";
  if (/relay candidates|TURN policy/i.test(error)) return "spice.connectionRelayFailed";
  if (/ICE connected/i.test(error)) return "spice.connectionCaptureFailed";
  if (/no remote SDP|did not provide an ICE configuration/i.test(error))
    return "spice.connectionHostStartup";
  return "spice.connectionFailed";
}
