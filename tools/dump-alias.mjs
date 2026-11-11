import fs from "node:fs";
const L=JSON.parse(fs.readFileSync(".asar-extract/tokens-light.json","utf8"));
const D=JSON.parse(fs.readFileSync(".asar-extract/tokens-dark.json","utf8"));
const rows=[];
for (const k of Object.keys(L)) if(k.startsWith("--dsw-alias-")) rows.push([k,L[k],D[k]??""]);
console.log(rows.map(r=>r[0].replace("--dsw-alias-","")+" | "+r[1]+" | "+r[2]).join("\n"));
