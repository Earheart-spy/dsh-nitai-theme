import fs from "node:fs";
const o=JSON.parse(fs.readFileSync(".asar-extract/tokens-light.json","utf8"));
console.log(Object.keys(o).filter(k=>k.startsWith("--dsw-static-")).join("\n"));
