import fs from "node:fs";
const src=fs.readFileSync(".asar-extract/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js","utf8");
const re=/const css\$\d+ = "((?:[^"\\]|\\.)*)"/g;
let m,i=0,out="";
while((m=re.exec(src))){ let css; try{css=JSON.parse('"'+m[1]+'"')}catch(e){continue} i++; out+=`\n/* ==== block ${i} (${css.length}) ==== */\n`+css; }
fs.writeFileSync(".asar-extract/conversation-all.css",out,"utf8");
console.log("blocks",i,"bytes",out.length);
