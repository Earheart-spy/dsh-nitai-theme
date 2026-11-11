import fs from "node:fs";
const s=fs.readFileSync("C:/Users/18385/Documents/dsh/my-plugin/lib/index.js","utf8");
for(const kw of ["function balanceSummary","function getSessionCost"]){
 const i=s.indexOf(kw); console.log("\n###",kw,"\n",s.slice(i,i+900));
}
