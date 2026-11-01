import shellTokens from "@ovule/shell/shell.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { useService } from "@ovule/ioc/react";

import {
  CatalogSection,
  CatalogForm,
  Field,
  FormActions,
  CardList,
  CatalogCard,
} from "@ovule/ui/SettingsSection";
import type { SettingsSectionProps as Props } from "@ovule/settings/settings/settings";
type SkillsSectionDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
};

function SkillsSectionContent({
  dependencies,
  props,
}: {
  dependencies: SkillsSectionDependencies;
  props: Props;
}) {
  const { shell } = dependencies;
  const { snapshot, busy, invoke } = props;

  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const save = async () => {
    await invoke((api) => api.importSkill(path, true));
    setPath("");
  };
  const choose = async () => {
    const selected = await (
      await shell.dialog()
    ).openFile({
      title: t("catalog.chooseSkill"),
      defaultPath: path || undefined,
      extensions: [["md"]],
    });
    if (selected) setPath(selected);
  };
  return (
    <CatalogSection title={t("catalog.agentSkills")} note={t("catalog.skillNote")}>
      <CatalogForm>
        <Field label={t("catalog.skillPath")}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="D:\\workspace\\.agents\\skills\\review"
            />
            <Button
              aria-label={t("catalog.chooseSkill")}
              title={t("catalog.chooseSkill")}
              size="icon"
              variant="ghost"
              onClick={() => void choose()}
            >
              <FolderOpen size={14} />
            </Button>
          </div>
        </Field>
        <FormActions
          busy={busy}
          valid={Boolean(path.trim())}
          save={save}
          label={t("catalog.import")}
        />
      </CatalogForm>
      <CardList>
        {snapshot.skills.map((skill) => (
          <CatalogCard
            key={skill.id}
            title={skill.name}
            meta={skill.path}
            healthy={skill.enabled}
            enabled={skill.enabled}
            detail={skill.description}
            onToggle={() => void invoke((api) => api.setSkillEnabled(skill.id, !skill.enabled))}
            onDelete={() => void invoke((api) => api.removeSkill(skill.id))}
          />
        ))}
      </CardList>
    </CatalogSection>
  );
}

export const SkillsSectionFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const dependencies = { shell };
  return function SkillsSection(props: Props) {
    return createElement(SkillsSectionContent, { dependencies, props });
  };
}, "SkillsSection");

export const SkillsSection = (...args: Parameters<ServiceOf<typeof SkillsSectionFactory>>) =>
  createElement(useService(SkillsSectionFactory), ...args);
