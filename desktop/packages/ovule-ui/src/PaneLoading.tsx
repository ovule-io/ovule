import styles from "./PaneLoading.module.css";

export function PaneLoading({ error, label = "Loading…" }: { error?: string; label?: string }) {
  return (
    <main
      className={styles.loading}
      role={error ? "alert" : "status"}
      aria-label={error ? undefined : label}
      aria-busy={!error}
    >
      {error ? (
        <p className={styles.error}>{error}</p>
      ) : (
        <div className={styles.skeleton} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
    </main>
  );
}
