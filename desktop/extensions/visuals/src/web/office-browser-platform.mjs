// Browser implementations required by the unbundled ExcelJS/JSZip entries.
// These provide buffers and scheduling, without native Node process capabilities.
import { Buffer } from "buffer/";
import process from "process/browser";

globalThis.Buffer ??= Buffer;
globalThis.process ??= process;
