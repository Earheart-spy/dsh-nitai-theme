import fs from "node:fs";
const css = fs.readFileSync(".asar-extract/design-platform.css","utf8");
console.log("len",css.length,"lines",css.split("\n").length);
const names = new Set(), prefixes = {};
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) { names.add(m[1]); }
for (const n of names) { const p = n.split("-").slice(0,3).join("-"); prefixes[p]=(prefixes[p]||0)+1; }
console.log("vars",names.size); console.log(Object.entries(prefixes).sort((a,b)=>b[1]-a[1]).slice(0,25));
console.log([...names].filter(n=>n.includes("shadow")));
console.log([...names].filter(n=>n.startsWith("--mdvr-")).slice(0,80).join("\n"));
