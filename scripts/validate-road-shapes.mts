import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchRouteShapes } from '../src/core/route-shape';
import { parseDelimited, decodeText } from '../src/core/parser';
import { normalizeRouteStopMasterRows, suggestRouteStopMasterMapping } from '../src/core/route-master';
import { MotisSidecar } from '../src/main/motis-sidecar';
import type { RouteSegmentMetric } from '../src/shared/types';
const root=resolve('.'); const output=join(root,'test-artifacts','road-shapes');
const sourcePath=process.env.ROAD_SHAPES_SOURCE??'C:/Users/User/Desktop/Study/교통카드모음/1. 여수시/2. 교통카드/DATA_20240415/ROUTESTTN_20240415.dat';
const source=await readFile(sourcePath);
const headers=Array.from({length:14},(_,i)=>`필드${i+1}`);
const rows=parseDelimited(decodeText(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), 'euc-kr'),'|').map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
const stops=normalizeRouteStopMasterRows(rows,suggestRouteStopMasterMapping(headers,rows)).stops.filter(s=>s.routeId.startsWith('460'));
const routeIds=[...new Set(stops.map(s=>s.routeId))].sort();
// Evenly spaced deterministic sample across all 77 local routes, complete stop sequences.
const selected=Array.from({length:20},(_,i)=>routeIds[Math.floor(i*routeIds.length/20)]);
if(new Set(selected).size!==20)throw new Error('Need at least 20 actual Yeosu routes');
await mkdir(output,{recursive:true});
const port=await new Promise<number>((resolvePort,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();const p=typeof a==='object'&&a?a.port:0;s.close(()=>resolvePort(p));});});
const binary=process.env.MOTIS_EXECUTABLE_PATH||join(root,'vendor/motis/patched-windows/motis.exe');
const pbf=join(root,'data/osm/south-korea-latest.osm.pbf'); const config=join(output,'config.yml');
await writeFile(config,`osm: ${pbf.replaceAll('\\','/')}\nstreet_routing: true\nserver:\n  host: 127.0.0.1\n  port: ${port}\n  n_threads: 1\n`);
if(!existsSync(join(output,'data/osr/routing.bin'))) await promisify(execFile)(binary,['import','-c',config,'-d',join(output,'data'),'--filter','osr'],{cwd:root,windowsHide:true,env:{...process.env,TBB_NUM_THREADS:'1'},maxBuffer:32*1024*1024});
await writeFile(join(output,'data/config.yml'),await readFile(config,'utf8'));
const sidecar=new MotisSidecar(); const routes:unknown[]=[];
try {
  const status=await sidecar.start({executablePath:binary,dataDirectory:output,osmPbfPath:pbf,port,args:['server','-d',join(output,'data')],environment:{TBB_NUM_THREADS:'1'},healthPath:'/api/v1/health',startupTimeoutMs:30000});
  if(status.state!=='ready') throw new Error(status.message);
  for(const routeId of selected) {
    const ordered=stops.filter(s=>s.routeId===routeId).sort((a,b)=>a.stationSequence-b.stationSequence);
    const metrics:RouteSegmentMetric[]=ordered.slice(1).map((b,i)=>{const a=ordered[i];return {routeId,routeName:a.routeName,transportMode:'B',direction:'forward',directionLabel:'원본 순서',fromSequence:a.stationSequence,toSequence:b.stationSequence,fromStationId:a.stationId,toStationId:b.stationId,fromStationName:a.stationName,toStationName:b.stationName,fromLatitude:a.latitude,fromLongitude:a.longitude,toLatitude:b.latitude,toLongitude:b.longitude,previousOnboard:0,boardings:0,alightings:0,onboardPassengers:0,peakOnboardPassengers:0,averageOnboardPassengers:0,totalBoardings:0,totalAlightings:0,vehicleCapacity:null,dailyTrips:null,congestionPercent:null,rank:0};});
    const raw:unknown[]=[];const started=performance.now();
    const result=await fetchRouteShapes(metrics,async(path,init)=>{const response=await sidecar.request(path,init);raw.push(response);return response;});
    const entry={routeId,routeName:ordered[0].routeName,stopCount:ordered.length,elapsedMs:performance.now()-started,quality:result.quality,warnings:result.warnings,cases:metrics.map((m,i)=>({from:m.fromStationName,to:m.toStationName,...result.segments[i],raw:raw[i]}))};
    routes.push(entry);console.log(JSON.stringify({routeId,quality:result.quality}));
  }
  const failedProbe=await sidecar.request('/api/route',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:'bus',start:{lat:0.1,lng:0.1},destination:{lat:0.2,lng:0.2},max:3600})});
  await writeFile(join(output,'evaluation-real.json'),JSON.stringify({timestamp:new Date().toISOString(),binary,port,sourcePath,sourceSha256:createHash('sha256').update(source).digest('hex'),routeCount:routes.length,routes,failedProbe,restrictionVerification:'Specific one-way and BUS access tags not independently verified. Do not infer restriction compliance from geometric success.'},null,2));
} finally {await sidecar.stop();}
