import { registry } from "./isolated";
import { registerMessageBlock as chart } from "./web/echarts-block";
import { registerMessageBlock as drawing } from "./web/excalidraw-block";
import { registerFileEditor } from "./web/office-editor";

chart(registry);
drawing(registry);
registerFileEditor(registry);
