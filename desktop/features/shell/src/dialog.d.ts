export interface OpenFileDialogOptions {
  title?: string;
  defaultPath?: string;
  extensions?: string[][];
}

export interface OpenDirectoryDialogOptions {
  title?: string;
}

export type DialogApi = {
  saveFile(options: OpenFileDialogOptions, contents: number[]): Promise<string | undefined>;
  openFile(options?: OpenFileDialogOptions): Promise<string | undefined>;
  openDirectory(options?: OpenDirectoryDialogOptions): Promise<string | undefined>;
};
