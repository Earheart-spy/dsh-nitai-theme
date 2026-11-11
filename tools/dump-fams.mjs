import fs from "node:fs";
const css=fs.readFileSync(".asar-extract/design-platform.utf8.css","utf8");
const blocks=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({sel:m[1].trim(),body:m[2]}));
const parse=(b)=>{const o={};for(const d of b.split(";")){const i=d.indexOf(":");if(i<0)continue;const k=d.slice(0,i).trim();if(k.startsWith("--"))o[k]=d.slice(i+1).trim();}return o;};
const L={...parse(blocks[0].body),...parse(blocks[2].body)};
const D={...parse(blocks[1].body),...parse(blocks[3].body)};
console.log("merged L",Object.keys(L).length,"D",Object.keys(D).length);
const fams={};for(const k of Object.keys(L)){const p=k.split("-").slice(0,4).join("-");fams[p]=(fams[p]||0)+1;}
console.log(Object.entries(fams).sort((a,b)=>b[1]-a[1]));
console.log("STATIC"); console.log(Object.keys(L).filter(k=>k.includes("static")).join("\n"));
console.log("MDVR"); console.log(Object.keys(L).filter(k=>k.includes("mdvr")).join("\n"));
console.log("DARK-only sample", Object.keys(D).filter(k=>!k.startsWith("--dsw-static")).slice(0,120).join("\n"));
