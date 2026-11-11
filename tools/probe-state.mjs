import fs from "node:fs";
const s=fs.readFileSync("C:/Users/18385/Documents/dsh/my-plugin/lib/index.js","utf8");
const i=s.indexOf("${PREFIX}/state.json");
console.log(s.slice(i-300,i+1900));
