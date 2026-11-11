import fs from "node:fs";
const archive="D:/software/deepseek-harness/resources/app.asar";
const fd=fs.openSync(archive,"r");
const base=Buffer.alloc(16); fs.readSync(fd,base,0,16,0);
const headerSize=base.readUInt32LE(4), jsonSize=base.readUInt32LE(12);
const json=Buffer.alloc(jsonSize); fs.readSync(fd,json,0,jsonSize,16);
const header=JSON.parse(json.toString("utf8")); const dataStart=8+headerSize;
function walk(node,prefix,out){for(const [n,c] of Object.entries(node.files||{})){const full=prefix?prefix+"/"+n:n;if(c.files)walk(c,full,out);else out.push({path:full,size:c.size,offset:String(c.offset)});}}
const out=[]; walk(header,"",out);
const targets=out.filter(f=>/dsh-client-ui-(conversation|chat|input|layout|sidebar)\/lib\/client\.js$/.test(f.path));
const words=["data-composer-seat","composerCard","composer-card","contenteditable","发送消息","给 DeepSeek"];
for(const f of targets){
  const buf=Buffer.alloc(f.size); fs.readSync(fd,buf,0,f.size,dataStart+Number(f.offset));
  const s=buf.toString("utf8");
  const hits=words.map(w=>[w,s.indexOf(w)]).filter(([w,i])=>i>=0);
  console.log("FILE",f.path,f.size,JSON.stringify(hits));
}
fs.closeSync(fd);
