import fs from "node:fs";
const css=fs.readFileSync(".asar-extract/design-platform.utf8.css","utf8");
const blocks=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({sel:m[1].trim(),body:m[2]}));
const parse=(b)=>{const o={};for(const d of b.split(";")){const i=d.indexOf(":");if(i<0)continue;const k=d.slice(0,i).trim();if(k.startsWith("--"))o[k]=d.slice(i+1).trim();}return o;};
const L={...parse(blocks[0].body),...parse(blocks[2].body)};
const D={...parse(blocks[1].body),...parse(blocks[3].body)};
for(const k of Object.keys(L)) if(/bg-|label-|border-|interactive-|specific-|button-/.test(k)) console.log(k+" | "+L[k]+" | "+D[k]);
