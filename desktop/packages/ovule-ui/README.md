# @ovule/ui

Reusable, theme-aware React primitives for Ovule surfaces. The package keeps
components in small subpath modules so applications only bundle what they use.

Import `@ovule/ui/styles.css` once at the application root. It includes the
complete light/dark semantic theme and component styles. Components may then be
imported from focused entry points such as `@ovule/ui/button`,
`@ovule/ui/form`, `@ovule/ui/surface`, `@ovule/ui/status`,
`@ovule/ui/data-display`, and `@ovule/ui/navigation`.

The semantic theme includes background, foreground, surface, text, border,
input, focus ring, primary, secondary, muted, accent, destructive, chart,
terminal, and application layout tokens. A host can override tokens on `:root`
or `[data-theme="dark"]` without changing component CSS.

The root entry is convenient for component libraries and tests. Product code
should prefer subpath imports. CSS is the package's only declared side effect;
unused TypeScript component modules remain tree-shakeable.
