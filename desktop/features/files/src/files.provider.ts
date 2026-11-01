import tokens from "./files.token";
import { value, type Register } from "@ovule/ioc";
import { markdownPaneDefinition } from "./markdown/pane";
import { localFilesPaneDefinition } from "./local-files/pane";
import { fileEditorPaneDefinition } from "./file-editor/pane";
export default function register(register: Register): void {
  register(tokens.markdownPaneDefinition, value(markdownPaneDefinition));
  register(tokens.localFilesPaneDefinition, value(localFilesPaneDefinition));
  register(tokens.fileEditorPaneDefinition, value(fileEditorPaneDefinition));
}
