import fs from "node:fs";
const l=JSON.parse(fs.readFileSync(".asar-extract/tokens-light.json","utf8"));
const keys=Object.keys(l).filter(k=>k.startsWith("--dsw-alias-"));
console.log(keys.join("\n"));
console.log("COUNT",keys.length);
