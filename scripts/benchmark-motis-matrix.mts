import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { cpus, totalmem, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { parseDelimited } from '../src/core/parser';
import { normalizeRouteStopMasterRows, suggestRouteStopMasterMapping } from '../src/core/route-master';
import { buildSyntheticGtfsDraft, DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS } from '../src/core/synthetic-gtfs/draft-builder';
import { buildMotisPlanPath } from '../src/core/motis';
import { normalizeMotisJourney } from '../src/core/transit-comparison';
import { matrixRequest, runBoundedMatrix, mergeGtfsPackages, LatencyHistogram } from '../src/core/motis-matrix';
import { MotisSidecar } from '../src/main/motis-sidecar';

const exec = promisify(execFile);
const root = resolve(process.cwd());
const smoke = process.argv.includes('--smoke');
const sourcePath = process.env.MOTIS_MATRIX_SOURCE ?? 'C:/Users/User/Desktop/Study/교통카드모음/1. 여수시/2. 교통카드/DATA_20240415/ROUTESTTN_20240415.dat';
const executablePath = process.env.MOTIS_EXECUTABLE_PATH ?? join(root,'vendor/motis/patched-windows/motis.exe');
const concurrency = Number(process.env.MOTIS_MATRIX_CONCURRENCY ?? 8);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error('Concurrency must be 1..64');
const output = join(root,'test-artifacts/motis-matrix',new Date().toISOString().replace(/[:.]/g,'-')+(smoke?'-smoke':''));
await mkdir(output,{recursive:true});
const abort = new AbortController();
process.on('SIGINT',()=>abort.abort()); process.on('SIGTERM',()=>abort.abort());
const source = await readFile(sourcePath);
const headers = Array.from({length:14},(_,i)=>`필드${i+1}`);
const rows = parseDelimited(new TextDecoder('utf-8').decode(source),'|').map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
const normalized = normalizeRouteStopMasterRows(rows,suggestRouteStopMasterMapping(headers,rows));
// Shared physical stations have one authoritative coordinate/name across all route files.
const regionalStops = normalized.stops.filter(stop=>stop.routeId.startsWith('460'));
const canonical = new Map(regionalStops.map(stop=>[stop.stationId,stop]));
const stops = regionalStops.map(stop=>({...stop,stationName:canonical.get(stop.stationId)!.stationName,latitude:canonical.get(stop.stationId)!.latitude,longitude:canonical.get(stop.stationId)!.longitude}));
const routes = [...new Set(stops.map(stop=>stop.routeId))].sort();
const ids = [...canonical.keys()].sort();
if (ids.length < 200) throw new Error(`Expected >=200 authentic stops, got ${ids.length}`);
const sampled = Array.from({length:200},(_,i)=>ids[Math.floor(i*ids.length/200)]);
const size = smoke?3:100;
const origins = sampled.slice(0,size); const destinations = sampled.slice(100,100+size);
const departures = Array.from({length:smoke?2:24},(_,i)=>`${String(smoke?8+i:i).padStart(2,'0')}:00:00`);
const total = origins.length*destinations.length*departures.length;
const metadata = {mode:'timetable-only; no OSM access/egress routing',sourcePath,sourceSha256:createHash('sha256').update(source).digest('hex'),routeCount:routes.length,physicalStopCount:ids.length,origins,destinations,departures,expectedCalls:total*2,concurrency,executablePath,executableSha256:createHash('sha256').update(await readFile(executablePath)).digest('hex'),cpu:cpus()[0].model,logicalCpus:cpus().length,ramBytes:totalmem(),os:release(),date:'2026-09-18',syntheticAssumptions:'All days 06:00–23:00, distance-based 15 km/h estimates, derived reverse direction, dwell 20 s. Before headway 20 min; After 15 min. Authentic route/stop topology; schedules are NOT observed service.'};
await writeFile(join(output,'input.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({output,...metadata}));
const results: unknown[] = [];
for (const label of ['before','after']) {
  if (abort.signal.aborted) break;
  const directory = join(output,label); await mkdir(directory,{recursive:true});
  const packages = routes.map(routeId=>buildSyntheticGtfsDraft(stops.filter(s=>s.routeId===routeId),[],{agencyId:'tap-agency',agencyName:'Synthetic regional benchmark',routeId,serviceDays:[0,1,2,3,4,5,6],firstDeparture:'06:00',lastDeparture:'23:00',vehicleCount:8,headwayMinutes:label==='before'?20:15,startDate:'20260101',endDate:'20261231',sourceName:sourcePath,deriveReverseDirection:true,dwellSeconds:20,travelTimeParameters:DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS}).files);
  const files = mergeGtfsPackages(packages);
  const zip = new JSZip(); for (const [name,content] of Object.entries(files)) zip.file(name,content);
  const archive = join(directory,'tap-synthetic-gtfs.zip'); await writeFile(archive,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const setupStart = performance.now();
  const command = async (args:string[], cwd:string) => { const result = await exec(executablePath,args,{cwd,windowsHide:true,maxBuffer:32*1024*1024}); await writeFile(join(directory,`${args[0]}.log`),result.stdout+result.stderr); };
  await command(['config',archive],directory);
  await writeFile(join(directory,'config.yml'),(await readFile(join(directory,'config.yml'),'utf8')).replace(/first_day: TODAY/, 'first_day: 2026-09-18'));
  await command(['import','-c',join(directory,'config.yml'),'-d',join(directory,'data'),'--filter','tt'],dirname(executablePath));
  const portServer = createServer(); portServer.listen(0,'127.0.0.1'); await once(portServer,'listening');
  const address = portServer.address(); if (!address || typeof address==='string') throw new Error('No dynamic port');
  const port = address.port; await new Promise<void>((resolve,reject)=>portServer.close(error=>error?reject(error):resolve()));
  if(port===8080) throw new Error('Refusing shared port');
  await writeFile(join(directory,'data/config.yml'),(await readFile(join(directory,'data/config.yml'),'utf8'))+`\nserver:\n  host: 127.0.0.1\n  port: ${port}\n`);
  let pid:number|undefined;
  const logs = createWriteStream(join(directory,'server.log'));
  const sidecar = new MotisSidecar({spawn:(command,args,options)=>{const child=spawn(command,args,options);pid=child.pid;child.stdout?.on('data',chunk=>logs.write(chunk));child.stderr?.on('data',chunk=>logs.write(chunk));return child;}});
  const status = await sidecar.start({executablePath,dataDirectory:directory,osmPbfPath:'timetable-only',port,args:['server','-d',join(directory,'data')],healthPath:'/api/v1/health',startupTimeoutMs:120000});
  if(status.state!=='ready'){await sidecar.stop();logs.end();throw new Error(JSON.stringify(status));}
  const setupSeconds = (performance.now()-setupStart)/1000;
  const stream = createWriteStream(join(directory,'results.jsonl'));
  let completed=0, errors=0,noRoute=0,found=0,responseBytes=0,peakClientRss=process.memoryUsage().rss;
  const latency = new LatencyHistogram();
  const metrics: Array<{atSeconds:number;cpuSeconds:number;workingSetBytes:number}> = [];
  const start=performance.now(); const cpuStart=process.cpuUsage(); let sampling=false;
  const sample=async()=>{if(sampling)return;sampling=true;try { const result=await exec('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${pid} | Select-Object CPU,WorkingSet64 | ConvertTo-Json -Compress`],{windowsHide:true});const m=JSON.parse(result.stdout);metrics.push({atSeconds:(performance.now()-start)/1000,cpuSeconds:m.CPU,workingSetBytes:m.WorkingSet64}); } catch {} finally {sampling=false;} };
  await sample();
  const progress=setInterval(()=>{peakClientRss=Math.max(peakClientRss,process.memoryUsage().rss);console.log(JSON.stringify({label,completed,total,errors,noRoute,seconds:(performance.now()-start)/1000}));if(existsSync(join(output,'CANCEL')))abort.abort();void sample();},5000);
  try {
    await runBoundedMatrix(total,concurrency,async index=>{
      const request=matrixRequest(index,origins,destinations,departures); const began=performance.now();
      let record:Record<string,unknown>={index,...request};
      try {
        const response=await fetch(status.baseUrl+buildMotisPlanPath(request.origin,request.destination,'2026-09-18T08:00',request.departure),{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])});
        const text=await response.text(); responseBytes+=Buffer.byteLength(text);
        if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.slice(0,300)}`);
        const raw=JSON.parse(text);
        if(!Array.isArray(raw.itineraries))throw new Error('Malformed plan response: itineraries missing');
        const journey=normalizeMotisJourney(raw,`2026-09-18T${request.departure}+09:00`);
        if(journey.found)found++;else noRoute++;
        record={...record,status:journey.found?'found':'no-route',totalSeconds:journey.found?journey.totalSeconds:null,journey};
      }catch(error){errors++;record={...record,status:'error',error:String(error)};}
      const elapsed=performance.now()-began;latency.add(elapsed);completed++;
      if(!stream.write(JSON.stringify({...record,latencyMs:elapsed})+'\n'))await once(stream,'drain');
    },abort.signal);
  }finally{
    clearInterval(progress); await sample();
    stream.end();await once(stream,'finish');
    await sidecar.stop();logs.end();
  }
  const seconds=(performance.now()-start)/1000; const cpu=process.cpuUsage(cpuStart);
  const cpuIntervals=metrics.slice(1).map((m,i)=>(m.cpuSeconds-metrics[i].cpuSeconds)/(m.atSeconds-metrics[i].atSeconds)*100);
  const result={label,expected:total,completed,found,noRoute,errors,cancelled:abort.signal.aborted,setupSeconds,wallSeconds:seconds,odPerSecond:completed/seconds,meanLatencyMs:latency.sum/latency.count,p90LatencyMsUpperBound:latency.percentile(.9),responseBytes,resultBytes:(await stat(join(directory,'results.jsonl'))).size,client:{cpuSeconds:(cpu.user+cpu.system)/1e6,peakRssBytes:peakClientRss},motis:{pid,port,samples:metrics,peakWorkingSetBytes:metrics.length?Math.max(...metrics.map(m=>m.workingSetBytes)):null,averageCpuPercentOneCore:metrics.length>1?(metrics.at(-1)!.cpuSeconds-metrics[0].cpuSeconds)/(metrics.at(-1)!.atSeconds-metrics[0].atSeconds)*100:null,peakCpuPercentOneCore:cpuIntervals.length?Math.max(...cpuIntervals):null},cpuConvention:'100% = one logical core; sampled at ~5s, peaks may fall between samples'};
  results.push(result); await writeFile(join(output,'report.json'),JSON.stringify({metadata,results},null,2));console.log(JSON.stringify(result));
}
console.log(`Artifacts: ${output}`);



