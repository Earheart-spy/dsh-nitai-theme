import fs from "node:fs";
const s=fs.readFileSync("C:/Users/18385/Documents/dsh/my-plugin/lib/store.js","utf8");
const i=s.indexOf("function sessionView");
console.log(s.slice(i,i+700));
