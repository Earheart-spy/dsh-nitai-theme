import fs from "node:fs";
const s=fs.readFileSync(".asar-extract/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js","utf8");
for(const kw of ["composer-card","发送消息","composer_card","data-composer-card"]){
  let i=-1;
  while((i=s.indexOf(kw,i+1))>=0){ console.log("\n###",kw,i,"\n",s.slice(Math.max(0,i-700),i+900).replace(/\s+/g," ")); }
}
