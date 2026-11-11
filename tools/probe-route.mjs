import fs from "node:fs";
const s=fs.readFileSync("C:/Users/18385/Documents/dsh/my-plugin/lib/index.js","utf8");
const i=s.indexOf("function route(spec)");
console.log(s.slice(i-400,i+900));
