import fs from "node:fs";
const s=fs.readFileSync("C:/Users/18385/Documents/dsh/my-plugin/lib/index.js","utf8");
for(const m of s.matchAll(/path:\s*`\$\{PREFIX\}([^`]*)`/g)) console.log(m[1]);
for(const m of s.matchAll(/path:\s*["'`]\/dsh-costnotch([^"'`]*)["'`]/g)) console.log(m[1]);
