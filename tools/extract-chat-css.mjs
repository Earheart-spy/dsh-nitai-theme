import fs from "node:fs";
const src=fs.readFileSync(".asar-extract/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js","utf8");
const re=/const css\$\d+ = "((?:[^"\\]|\\.)*)"/g;
let m,i=0,out="";
while((m=re.exec(src))){ const css=JSON.parse('"'+m[1]+'"'); i++; out+=`\n/* ==== block ${i} (${css.length}) ==== */\n`+css; if(/composer/i.test(css)) console.log("composer in block",i,css.length); }
fs.writeFileSync(".asar-extract/chat.css",out,"utf8");
console.log("blocks",i,"bytes",out.length);
