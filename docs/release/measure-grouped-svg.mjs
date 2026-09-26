// Geometry-only microbenchmark. Not viewport/brush/native-process qualification.
import "../../tests/canvas-harness.ts";
import { createDocument, createGroupLayer, createPathLayer } from "../../app/engine/document.ts";
import { exportVectorSvg } from "../../app/engine/vector-delivery.ts";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { cpus } from "node:os";
const release=acquireQualificationLock("Grouped SVG microbenchmark"),sourceSha256=releaseSourceId();
try {
  const results=[];
  for(const dimension of [4096,8192,16384,32768,50000]) {
    const doc=createDocument(dimension,dimension),group=createGroupLayer("Campaign");group.opacity=.65;
    doc.layers=[group,...Array.from({length:100},(_,i)=>{
      const x=20+(i%10)*100,y=20+Math.floor(i/10)*100;
      const layer=createPathLayer(`Vector ${i}`,{anchors:[[x,y],[x+70,y],[x+70,y+70],[x,y+70]].map(([x,y])=>({x,y,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}})),closed:true,fill:"#2876cc",stroke:"none",strokeWidth:0});layer.parentId=group.id;return layer;
    })];
    for(let i=0;i<3;i++)exportVectorSvg(doc);
    const runs=[],rssBefore=process.memoryUsage().rss;let size=0,sampledRssMax=rssBefore;
    for(let i=0;i<20;i++){const start=performance.now();size=Buffer.byteLength(exportVectorSvg(doc));runs.push(performance.now()-start);sampledRssMax=Math.max(sampledRssMax,process.memoryUsage().rss);}
    const sorted=[...runs].sort((a,b)=>a-b);
    results.push({dimension,objects:101,anchors:400,svgBytes:size,runsMs:runs,p50Ms:sorted[9],p95Ms:sorted[18],worstMs:sorted[19],rssBeforeBytes:rssBefore,sampledRssMaxBytes:sampledRssMax});
  }
  const output=await mkdtemp(resolve("artifacts/grouped-svg-performance-"));
  const report={sourceSha256,unchanged:releaseSourceId()===sourceSha256,scope:"Node geometry-only SVG export; 3 warmups and 20 measured runs; no native UI, GPU, compositor or competitor comparison. RSS sampled between runs is not peak process memory.",cpu:cpus()[0]?.model,node:process.version,results};
  await writeFile(join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report},null,2));
} finally {release();}
