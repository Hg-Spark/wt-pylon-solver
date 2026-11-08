import {createHash} from "node:crypto";
import {readdir, mkdir, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import sharp from "sharp";
import Spritesmith from "spritesmith";

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const sources = join(frontend, ".icon-source");
const output = join(frontend, "public", "icons");

await mkdir(output, {recursive: true});
const inputFiles = (await readdir(sources).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
}))
  .filter((file) => file.endsWith(".png"))
  .sort()
  .map((file) => join(sources, file));

// Remove old per-icon WebPs and previous atlas builds.
for (const file of await readdir(output)) {
  if (file === "atlas.json" || /\.(png|webp)$/i.test(file)) {
    await rm(join(output, file));
  }
}

const manifest = {image: "", width: 0, height: 0, icons: {}};
if (inputFiles.length) {
  const result = await new Promise((resolve, reject) => {
    Spritesmith.run({src: inputFiles, algorithm: "binary-tree", padding: 2}, (error, sprite) => {
      if (error) reject(error);
      else resolve(sprite);
    });
  });
  const webp = await sharp(result.image).webp({lossless: true, effort: 4}).toBuffer();
  const hash = createHash("sha256").update(webp).digest("hex").slice(0, 12);
  manifest.image = `atlas-${hash}.webp`;
  manifest.width = result.properties.width;
  manifest.height = result.properties.height;
  manifest.icons = Object.fromEntries(
    Object.entries(result.coordinates).map(([file, rect]) => [basename(file, ".png"), rect]),
  );
  await writeFile(join(output, manifest.image), webp);
}
await writeFile(join(output, "atlas.json"), JSON.stringify(manifest));
console.log(`Sprite atlas: ${inputFiles.length} icons${manifest.image ? ` -> ${manifest.image}` : ""}`);
