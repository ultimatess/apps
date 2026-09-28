// Renders icons/icon.svg to the PNG sizes iOS / Android need, using headless Chrome.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { launch } from "../tests/e2e/cdp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(`${root}icons/icon.svg`, "utf8");
const browser = await launch();
try {
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage();
    await page.init({ width: size, height: size, mobile: false, scale: 1 });
    const html = `<html><body style="margin:0;background:#05070d">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`;
    await page.goto(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
    writeFileSync(`${root}icons/icon-${size}.png`, await page.screenshot());
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
