/** Dependencies may mark React Server Component boundaries with "use client".
 * Both Ovule HTML entries run entirely in the browser. Remove only dependency
 * directive prologues; preserve authored directives and all other diagnostics. */
export function clientDirectives() {
  return {
    name: "ovule-client-directives",
    enforce: "pre",
    transform(code, id) {
      const filename = id.split("?", 1)[0];
      if (
        id.startsWith("\0") ||
        !filename.includes("/node_modules/") ||
        !/\.[cm]?js$/.test(filename) ||
        !/(["'])use client\1/.test(code)
      )
        return;
      const ranges = [];
      for (const statement of this.parse(code).body) {
        if (
          statement.type !== "ExpressionStatement" ||
          typeof statement.expression?.value !== "string"
        )
          break;
        if (statement.expression.value === "use client")
          ranges.push([statement.start, statement.end]);
      }
      if (!ranges.length) return;
      // Preserve character offsets and line numbers for the dependency's maps.
      let transformed = code;
      for (const [start, end] of ranges)
        transformed =
          transformed.slice(0, start) +
          transformed.slice(start, end).replace(/[^\r\n]/g, " ") +
          transformed.slice(end);
      return { code: transformed, map: null };
    },
  };
}
