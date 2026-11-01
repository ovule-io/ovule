import { useEffect, useState } from "react";
import { useService } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import shellTokens from "@ovule/shell/shell.token";
import type { MessagePartView } from "@ovule/shell-api";
import { attachmentIdFromUrl, safeRemoteUrl } from "./part-assets";

export function useImageAttachment(part: MessagePartView) {
  const workspace = useService(workspaceTokens.workspace);
  const attachmentId = attachmentIdFromUrl(part.url);
  const [attachment, setAttachment] = useState<{ id: string; url: string; blob: Blob }>();
  const [loading, setLoading] = useState(Boolean(attachmentId));
  useEffect(() => {
    if (!attachmentId) {
      setAttachment(undefined);
      setLoading(false);
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    setLoading(true);
    void workspace
      .api()
      .then((api) => api.readMessageAttachment(attachmentId))
      .then((bytes) => {
        if (!active) return;
        const blob = new Blob([Uint8Array.from(bytes)], { type: part.mediaType ?? "image/png" });
        objectUrl = URL.createObjectURL(blob);
        setAttachment({ id: attachmentId, url: objectUrl, blob });
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setAttachment(undefined);
          setLoading(false);
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId, part.mediaType, workspace]);
  return {
    blob: attachment?.id === attachmentId ? attachment?.blob : undefined,
    source:
      safeRemoteUrl(part.url) ?? (attachment?.id === attachmentId ? attachment?.url : undefined),
    loading,
  };
}

async function imageBlob(source: string) {
  const response = await fetch(source);
  if (!response.ok) throw new Error("imageReadFailed");
  return response.blob();
}
async function imagePng(source: string, original?: Blob): Promise<Blob> {
  const blob = original ?? (await imageBlob(source));
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("imageCopyFailed");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("imageCopyFailed"))),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}
export function useImageActions(
  part: MessagePartView,
  source: string | undefined,
  original?: Blob,
) {
  const shell = useService(shellTokens.shell);
  const [busy, setBusy] = useState(false);
  const run = async (copy: boolean) => {
    if (!source || busy) return;
    setBusy(true);
    try {
      if (copy) {
        // Supply a promise while the user gesture is still active.
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": imagePng(source, original) }),
        ]);
      } else {
        const blob = original ?? (await imageBlob(source));
        const extension =
          (
            {
              "image/png": "png",
              "image/jpeg": "jpg",
              "image/gif": "gif",
              "image/webp": "webp",
            } as Record<string, string>
          )[blob.type] ?? "png";
        let name = (part.name ?? "image").split(/[\\/]/).pop() || "image";
        if (!/\.(?:png|jpe?g|gif|webp)$/i.test(name)) name += `.${extension}`;
        const path = await (
          await shell.dialog()
        ).saveFile({ defaultPath: name }, Array.from(new Uint8Array(await blob.arrayBuffer())));
        if (!path) return null;
      }
      return true;
    } catch (error) {
      console.error("Image action failed", copy ? "copy" : "save", error);
      throw error;
    } finally {
      setBusy(false);
    }
  };
  return { busy, copy: () => run(true), save: () => run(false) };
}
