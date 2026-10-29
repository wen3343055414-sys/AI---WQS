import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of [
  "index.html",
  "styles.css",
  "app.js",
  "core.js",
  "favicon.svg",
]) {
  await cp(
    new URL(`../public/${name}`, import.meta.url),
    new URL(name, output),
  );
}
await writeFile(new URL(".nojekyll", output), "");
console.log("静态站点已构建到 dist/，支持 GitHub Pages 项目子路径。");
