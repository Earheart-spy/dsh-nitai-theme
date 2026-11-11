import fs from "node:fs";
const o=JSON.parse(fs.readFileSync(".asar-extract/tokens-light.json","utf8"));
const ks=Object.keys(o);
console.log(ks.length);
console.log(ks.filter(k=>k.includes("static")).slice(0,30).join("\n"));
