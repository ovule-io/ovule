export type FrameworkLayoutState = {
  sidebarOpen: boolean;
  workbenchOpen: boolean;
  workbenchExpanded: boolean;
  workbenchTransitioning: boolean;
  sidebarWidth: number;
  workbenchWidth: number;
};

export interface FrameworkLayoutService {
  current(): FrameworkLayoutState;
  subscribe(listener: () => void): () => void;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  openWorkbench(): void;
  closeWorkbench(): void;
  toggleWorkbenchExpanded(): void;
  setSidebarWidth(width: number): void;
  setWorkbenchWidth(width: number): void;
}
