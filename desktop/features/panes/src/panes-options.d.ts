export type PanesStorage = Pick<Storage, "getItem" | "setItem">;
export type PanesOptions = {
  storage?: PanesStorage;
  createId?: () => string;
};
