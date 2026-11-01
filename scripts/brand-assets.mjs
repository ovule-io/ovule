#!/usr/bin/env node
// Export platform containers and small PNGs from the committed brand masters.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Brand exports require macOS sips");
const directory = fileURLToPath(new URL("../desktop/branding/", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "ovule-brand-"));
const resize = (source, size, destination) => {
  execFileSync("sips", ["-z", String(size), String(size), source, "--out", destination], {
    stdio: "pipe",
  });
};
async function ico(destination, images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const payloads = [];
  let offset = header.length;
  for (const [index, { size, filename }] of images.entries()) {
    const png = await readFile(filename);
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    payloads.push(png);
    offset += png.length;
  }
  await writeFile(destination, Buffer.concat([header, ...payloads]));
}
try {
  const master = path.join(directory, "masters/app-icon.png");
  // macOS 26 masks the square artwork itself. Pre-rounded transparent artwork
  // can be reduced into a second system tile, producing a nested icon.
  const macMaster = path.join(directory, "masters/app-icon-macos.png");
  const iconset = path.join(temporary, "Ovule.iconset");
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    resize(macMaster, size, path.join(iconset, `icon_${size}x${size}.png`));
    resize(macMaster, size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  // Modern ICNS stores PNG payloads in typed, length-prefixed image chunks.
  const chunks = [];
  for (const [type, filename] of [
    ["icp4", "icon_16x16.png"],
    ["icp5", "icon_32x32.png"],
    ["icp6", "icon_32x32@2x.png"],
    ["ic07", "icon_128x128.png"],
    ["ic08", "icon_256x256.png"],
    ["ic09", "icon_512x512.png"],
    ["ic10", "icon_512x512@2x.png"],
    ["ic11", "icon_16x16@2x.png"],
    ["ic12", "icon_32x32@2x.png"],
    ["ic13", "icon_128x128@2x.png"],
    ["ic14", "icon_256x256@2x.png"],
  ]) {
    const png = await readFile(path.join(iconset, filename));
    const chunk = Buffer.alloc(8);
    chunk.write(type);
    chunk.writeUInt32BE(8 + png.length, 4);
    chunks.push(chunk, png);
  }
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4);
  await writeFile(path.join(directory, "app-icon.icns"), Buffer.concat([header, ...chunks]));
  resize(master, 1024, path.join(directory, "app-icon.png"));
  resize(macMaster, 1024, path.join(directory, "app-icon-macos.png"));
  const appImages = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const filename = path.join(temporary, `app-${size}.png`);
    resize(master, size, filename);
    appImages.push({ size, filename });
  }
  await ico(path.join(directory, "app-icon.ico"), appImages);
  for (const theme of ["", "-dark"]) {
    const images = [];
    for (const size of [16, 32, 48, 64]) {
      const filename = path.join(directory, `favicon${theme}-${size}.png`);
      resize(path.join(directory, `masters/favicon${theme}.png`), size, filename);
      images.push({ size, filename });
    }
    await ico(path.join(directory, `favicon${theme}.ico`), images);
  }
  resize(
    path.join(directory, "masters/menu-template.png"),
    18,
    path.join(directory, "menuTemplate.png"),
  );
  resize(
    path.join(directory, "masters/menu-template.png"),
    36,
    path.join(directory, "menuTemplate@2x.png"),
  );
  console.log("brand_assets=exported macos=icns windows=ico favicon=light,dark menu=1x,2x");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
