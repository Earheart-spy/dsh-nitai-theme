import fs from "node:fs";
const s=fs.readFileSync("C:/Users/18385/Documents/dsh/nitai-theme/.asar-extract/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js","utf8");
const i=s.indexOf("function renderRow");
console.log(s.slice(i-1200,i+2600));
