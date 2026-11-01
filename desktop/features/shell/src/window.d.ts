export interface WindowInfo {
  postMessage?(message: unknown, options: { targetOrigin: string; transfer: unknown[] }): void;
  id: bigint;
  maximized: boolean;
  minimized: boolean;
  fullscreen: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface WindowOptions {
  label?: string;
  url?: string;
  title?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  focused?: boolean;
}

export type WindowApi = {
  setConstraints?(
    constraints: { minWidth: number; minHeight: number; maxWidth?: number; maxHeight?: number },
    id?: bigint,
  ): Promise<WindowInfo>;
  current(): Promise<WindowInfo>;
  create(options?: WindowOptions): Promise<WindowInfo>;
  minimize(id?: bigint): Promise<WindowInfo>;
  maximize(id?: bigint): Promise<WindowInfo>;
  restore(id?: bigint): Promise<WindowInfo>;
  close(id?: bigint): Promise<void>;
  setBounds?(
    bounds: { x: number; y: number; width: number; height: number },
    id?: bigint,
  ): Promise<WindowInfo>;
};
