export function shellApiChannel(command, environment = process.env) {
  const channel = environment.OVULE_BUILD_CHANNEL ?? (command === "serve" ? "debug" : "release");
  if (!["debug", "release"].includes(channel))
    throw new Error(`Invalid OVULE_BUILD_CHANNEL: ${channel}`);
  return {
    channel,
    bindings: `desktop/packages/ovule-shell-api/generated/${channel === "debug" ? "debug/" : ""}index.js`,
  };
}
