import fs from "node:fs";
const f=".asar-extract/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js";
const src=fs.readFileSync(f,"utf8");
const lines=src.split("\n");
const i=lines.findIndex(l=>l.includes('const css$4 = "'));
const m=lines[i].match(/const css\$4 = "((?:[^"\\]|\\.)*)"/);
const css=JSON.parse('"'+m[1]+'"');
fs.writeFileSync(".asar-extract/conversation.css",css,"utf8");
console.log(css.slice(0,6000));
