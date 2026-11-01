import { Checkbox } from "@ovule/ui/form";
import { Plus, Trash2 } from "lucide-react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";
import styles from "./SettingsSection.module.css";

export function CatalogSection({
  title,
  note,
  onAdd,
  children,
}: {
  title: string;
  note: string;
  onAdd?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.catalogSection}>
      <header className={styles.catalogSectionHeader} data-catalog-section-header>
        <div className={styles.catalogSectionHeading}>
          <h3 className={styles.catalogSectionTitle}>{title}</h3>
          <p className={styles.catalogSectionNote}>{note}</p>
        </div>
        {onAdd && (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <Plus size={14} />
            {t("catalog.new")}
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}
export function CatalogForm({ children }: { children: ReactNode }) {
  return <div className={cn("catalog-form", styles.catalogForm)}>{children}</div>;
}
export function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactElement<{ className?: string }>;
  full?: boolean;
}) {
  return (
    <label className={cn(styles.catalogField, full && styles.catalogFieldFull)}>
      <span className={styles.catalogFieldLabel}>{label}</span>
      {cloneElement(children, {
        className: cn(
          children.props.className,
          styles.catalogFieldControl,
          children.type === "textarea" && styles.catalogTextarea,
        ),
      })}
    </label>
  );
}
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className={cn("catalog-check", styles.catalogCheck)}>
      <Checkbox
        className={styles.catalogCheckbox}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
export function CheckList({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: Array<{ id: string; label: string }>;
  selected: string[];
  onChange(value: string[]): void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className={styles.catalogChecks}>
      <legend className={styles.catalogChecksLegend}>{label}</legend>
      {items.length ? (
        items.map((item) => (
          <Check
            key={item.id}
            label={item.label}
            checked={selected.includes(item.id)}
            onChange={(checked) =>
              onChange(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
            }
          />
        ))
      ) : (
        <small>{t("catalog.none")}</small>
      )}
    </fieldset>
  );
}
export function FormActions({
  busy,
  valid,
  save,
  cancel,
  label,
}: {
  busy: boolean;
  valid: boolean;
  save(): Promise<void>;
  cancel?: () => void;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.catalogActions}>
      <Button size="sm" disabled={busy || !valid} onClick={() => void save()}>
        {label ?? t("catalog.save")}
      </Button>
      {cancel && (
        <Button size="sm" variant="ghost" onClick={cancel}>
          {t("catalog.cancel")}
        </Button>
      )}
    </div>
  );
}
export function CardList({ children }: { children: ReactNode }) {
  return <div className={styles.catalogList}>{children}</div>;
}

export function CatalogCard({
  children,
  title,
  meta,
  detail,
  healthy,
  enabled,
  onEdit,
  onToggle,
  onDelete,
}: {
  children?: ReactNode;
  title: string;
  meta: string;
  detail: string;
  healthy: boolean;
  enabled?: boolean;
  onEdit?: () => void;
  onToggle?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article className={cn("catalog-card", styles.catalogCard)}>
      <div className={styles.catalogCardTitle}>
        <span className={cn(styles.health, healthy && styles.ok)} />
        <strong>{title}</strong>
      </div>
      <code className={styles.catalogCardMeta}>{meta}</code>
      <p className={styles.catalogCardDetail}>{detail}</p>
      {children}
      <div className={styles.catalogCardActions}>
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {t("catalog.edit")}
          </Button>
        )}
        {onToggle && (
          <Button size="sm" variant="ghost" onClick={onToggle}>
            {enabled ? t("catalog.disable") : t("catalog.enable")}
          </Button>
        )}
        {onDelete && (
          <Button
            size="icon"
            variant="danger"
            aria-label={t("catalog.remove", { title })}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </article>
  );
}
