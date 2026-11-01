import { useEffect, useState } from "react";
import {
  AppWindow,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  Hand,
  MonitorUp,
  SquareTerminal,
  Workflow,
} from "lucide-react";
import type { PaneInstance } from "@ovule/panes/tab";
import { sidebarTabIconName, sidebarTabIconSource } from "./sidebar-tab-icon";
import styles from "./SidebarTabIcon.module.css";
import folderLatte from "./icons/catppuccin/latte/_folder.svg";
import folderMocha from "./icons/catppuccin/mocha/_folder.svg";
import spreadsheetLatte from "./icons/catppuccin/latte/ms-excel.svg";
import spreadsheetMocha from "./icons/catppuccin/mocha/ms-excel.svg";
import markdownLatte from "./icons/catppuccin/latte/markdown.svg";
import markdownMocha from "./icons/catppuccin/mocha/markdown.svg";
import documentLatte from "./icons/catppuccin/latte/ms-word.svg";
import documentMocha from "./icons/catppuccin/mocha/ms-word.svg";
import presentationLatte from "./icons/catppuccin/latte/ms-powerpoint.svg";
import presentationMocha from "./icons/catppuccin/mocha/ms-powerpoint.svg";
import pdfLatte from "./icons/catppuccin/latte/pdf.svg";
import pdfMocha from "./icons/catppuccin/mocha/pdf.svg";
import imageLatte from "./icons/catppuccin/latte/image.svg";
import imageMocha from "./icons/catppuccin/mocha/image.svg";
import videoLatte from "./icons/catppuccin/latte/video.svg";
import videoMocha from "./icons/catppuccin/mocha/video.svg";
import audioLatte from "./icons/catppuccin/latte/audio.svg";
import audioMocha from "./icons/catppuccin/mocha/audio.svg";
import fileLatte from "./icons/catppuccin/latte/_file.svg";
import fileMocha from "./icons/catppuccin/mocha/_file.svg";

import javascriptLatte from "./icons/catppuccin/latte/javascript.svg";
import javascriptMocha from "./icons/catppuccin/mocha/javascript.svg";
import javascriptReactLatte from "./icons/catppuccin/latte/javascript-react.svg";
import javascriptReactMocha from "./icons/catppuccin/mocha/javascript-react.svg";
import typescriptLatte from "./icons/catppuccin/latte/typescript.svg";
import typescriptMocha from "./icons/catppuccin/mocha/typescript.svg";
import typescriptReactLatte from "./icons/catppuccin/latte/typescript-react.svg";
import typescriptReactMocha from "./icons/catppuccin/mocha/typescript-react.svg";
import pythonLatte from "./icons/catppuccin/latte/python.svg";
import pythonMocha from "./icons/catppuccin/mocha/python.svg";
import rustLatte from "./icons/catppuccin/latte/rust.svg";
import rustMocha from "./icons/catppuccin/mocha/rust.svg";
import goLatte from "./icons/catppuccin/latte/go.svg";
import goMocha from "./icons/catppuccin/mocha/go.svg";
import jsonLatte from "./icons/catppuccin/latte/json.svg";
import jsonMocha from "./icons/catppuccin/mocha/json.svg";
import yamlLatte from "./icons/catppuccin/latte/yaml.svg";
import yamlMocha from "./icons/catppuccin/mocha/yaml.svg";
import tomlLatte from "./icons/catppuccin/latte/toml.svg";
import tomlMocha from "./icons/catppuccin/mocha/toml.svg";
import cssLatte from "./icons/catppuccin/latte/css.svg";
import cssMocha from "./icons/catppuccin/mocha/css.svg";
import htmlLatte from "./icons/catppuccin/latte/html.svg";
import htmlMocha from "./icons/catppuccin/mocha/html.svg";
import cLatte from "./icons/catppuccin/latte/c.svg";
import cMocha from "./icons/catppuccin/mocha/c.svg";
import cppLatte from "./icons/catppuccin/latte/cpp.svg";
import cppMocha from "./icons/catppuccin/mocha/cpp.svg";
import cppHeaderLatte from "./icons/catppuccin/latte/cpp-header.svg";
import cppHeaderMocha from "./icons/catppuccin/mocha/cpp-header.svg";
import csharpLatte from "./icons/catppuccin/latte/csharp.svg";
import csharpMocha from "./icons/catppuccin/mocha/csharp.svg";
import javaLatte from "./icons/catppuccin/latte/java.svg";
import javaMocha from "./icons/catppuccin/mocha/java.svg";
import kotlinLatte from "./icons/catppuccin/latte/kotlin.svg";
import kotlinMocha from "./icons/catppuccin/mocha/kotlin.svg";
import swiftLatte from "./icons/catppuccin/latte/swift.svg";
import swiftMocha from "./icons/catppuccin/mocha/swift.svg";
import rubyLatte from "./icons/catppuccin/latte/ruby.svg";
import rubyMocha from "./icons/catppuccin/mocha/ruby.svg";
import phpLatte from "./icons/catppuccin/latte/php.svg";
import phpMocha from "./icons/catppuccin/mocha/php.svg";
import vueLatte from "./icons/catppuccin/latte/vue.svg";
import vueMocha from "./icons/catppuccin/mocha/vue.svg";
import svelteLatte from "./icons/catppuccin/latte/svelte.svg";
import svelteMocha from "./icons/catppuccin/mocha/svelte.svg";
import xmlLatte from "./icons/catppuccin/latte/xml.svg";
import xmlMocha from "./icons/catppuccin/mocha/xml.svg";
import dockerLatte from "./icons/catppuccin/latte/docker.svg";
import dockerMocha from "./icons/catppuccin/mocha/docker.svg";
import makefileLatte from "./icons/catppuccin/latte/makefile.svg";
import makefileMocha from "./icons/catppuccin/mocha/makefile.svg";
import bashLatte from "./icons/catppuccin/latte/bash.svg";
import bashMocha from "./icons/catppuccin/mocha/bash.svg";
import powershellLatte from "./icons/catppuccin/latte/powershell.svg";
import powershellMocha from "./icons/catppuccin/mocha/powershell.svg";
import diffLatte from "./icons/catppuccin/latte/diff.svg";
import diffMocha from "./icons/catppuccin/mocha/diff.svg";
import cmakeLatte from "./icons/catppuccin/latte/cmake.svg";
import cmakeMocha from "./icons/catppuccin/mocha/cmake.svg";
import sassLatte from "./icons/catppuccin/latte/sass.svg";
import sassMocha from "./icons/catppuccin/mocha/sass.svg";
import databaseLatte from "./icons/catppuccin/latte/database.svg";
import databaseMocha from "./icons/catppuccin/mocha/database.svg";
import configLatte from "./icons/catppuccin/latte/config.svg";
import configMocha from "./icons/catppuccin/mocha/config.svg";
import lessLatte from "./icons/catppuccin/latte/less.svg";
import lessMocha from "./icons/catppuccin/mocha/less.svg";

const icons = {
  javascript: { light: javascriptLatte, dark: javascriptMocha },
  "javascript-react": { light: javascriptReactLatte, dark: javascriptReactMocha },
  typescript: { light: typescriptLatte, dark: typescriptMocha },
  "typescript-react": { light: typescriptReactLatte, dark: typescriptReactMocha },
  python: { light: pythonLatte, dark: pythonMocha },
  rust: { light: rustLatte, dark: rustMocha },
  go: { light: goLatte, dark: goMocha },
  json: { light: jsonLatte, dark: jsonMocha },
  yaml: { light: yamlLatte, dark: yamlMocha },
  toml: { light: tomlLatte, dark: tomlMocha },
  css: { light: cssLatte, dark: cssMocha },
  html: { light: htmlLatte, dark: htmlMocha },
  c: { light: cLatte, dark: cMocha },
  cpp: { light: cppLatte, dark: cppMocha },
  "cpp-header": { light: cppHeaderLatte, dark: cppHeaderMocha },
  csharp: { light: csharpLatte, dark: csharpMocha },
  java: { light: javaLatte, dark: javaMocha },
  kotlin: { light: kotlinLatte, dark: kotlinMocha },
  swift: { light: swiftLatte, dark: swiftMocha },
  ruby: { light: rubyLatte, dark: rubyMocha },
  php: { light: phpLatte, dark: phpMocha },
  vue: { light: vueLatte, dark: vueMocha },
  svelte: { light: svelteLatte, dark: svelteMocha },
  xml: { light: xmlLatte, dark: xmlMocha },
  docker: { light: dockerLatte, dark: dockerMocha },
  makefile: { light: makefileLatte, dark: makefileMocha },
  bash: { light: bashLatte, dark: bashMocha },
  powershell: { light: powershellLatte, dark: powershellMocha },
  diff: { light: diffLatte, dark: diffMocha },
  cmake: { light: cmakeLatte, dark: cmakeMocha },
  sass: { light: sassLatte, dark: sassMocha },
  database: { light: databaseLatte, dark: databaseMocha },
  config: { light: configLatte, dark: configMocha },
  less: { light: lessLatte, dark: lessMocha },
  folder: { light: folderLatte, dark: folderMocha },
  spreadsheet: { light: spreadsheetLatte, dark: spreadsheetMocha },
  markdown: { light: markdownLatte, dark: markdownMocha },
  document: { light: documentLatte, dark: documentMocha },
  presentation: { light: presentationLatte, dark: presentationMocha },
  pdf: { light: pdfLatte, dark: pdfMocha },
  image: { light: imageLatte, dark: imageMocha },
  video: { light: videoLatte, dark: videoMocha },
  audio: { light: audioLatte, dark: audioMocha },
  file: { light: fileLatte, dark: fileMocha },
};

const internalIcons = {
  browser: AppWindow,
  files: FolderOpen,
  office: FileSpreadsheet,
  markdown: FileText,
  terminal: SquareTerminal,
  workflow: Workflow,
  spice: MonitorUp,
  handoff: Hand,
};

export function SidebarTabIcon({ tab }: { tab: PaneInstance }) {
  const source = sidebarTabIconSource(tab);
  if (source === "web") return <WebFavicon tab={tab} />;
  if (source === "internal") {
    const Icon = internalIcons[tab.kind];
    return (
      <span className={styles.icon} data-icon-source="lucide" aria-hidden="true">
        <Icon size={16} />
      </span>
    );
  }
  const name = sidebarTabIconName(tab);
  const icon = icons[name];
  return (
    <span
      className={styles.icon}
      data-tab-icon={name}
      data-icon-source="catppuccin"
      aria-hidden="true"
    >
      <img className={styles.light} src={icon.light} alt="" width={16} height={16} />
      <img className={styles.dark} src={icon.dark} alt="" width={16} height={16} />
    </span>
  );
}

function WebFavicon({ tab }: { tab: PaneInstance }) {
  const url = tab.url ?? tab.target ?? "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url, tab.favicon]);
  let favicon = tab.favicon;
  try {
    favicon ||= new URL("/favicon.ico", url).href;
  } catch {
    /* Invalid URLs retain the web icon. */
  }
  return (
    <span className={styles.icon} data-icon-source="favicon" aria-hidden="true">
      {favicon && !failed ? (
        <img src={favicon} width={16} height={16} alt="" onError={() => setFailed(true)} />
      ) : (
        <Globe size={16} />
      )}
    </span>
  );
}
