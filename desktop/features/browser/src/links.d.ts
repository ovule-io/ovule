import type { LinkOpening } from "@ovule/settings/preferences/preferences";
export type LinkRequest = {
  target: string;
  threadId?: string;
  navigation?: "allow" | "emit";
};
export interface LinkService {
  open(request: LinkRequest, mode?: LinkOpening): Promise<void>;
}
