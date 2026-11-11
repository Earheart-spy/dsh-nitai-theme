import fs from "node:fs";
const f=".asar-extract/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js";
const src=fs.readFileSync(f,"utf8");
const m=src.match(/const css = "((?:[^"\\]|\\.)*)"/);
if(!m){console.log("no match");process.exit(0)}
const css=JSON.parse('"'+m[1]+'"');
fs.writeFileSync(".asar-extract/layout.css",css,"utf8");
console.log(css.length);
console.log(css.slice(0,3000));
