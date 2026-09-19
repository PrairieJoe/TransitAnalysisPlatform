import { parseDelimited } from './parser';

export function matrixRequest(index: number, origins: string[], destinations: string[], departures: string[]) {
  const total = origins.length * destinations.length * departures.length;
  if (!Number.isInteger(index) || index < 0 || index >= total) throw new Error('Matrix index out of range');
  return { origin: origins[Math.floor(index / (destinations.length * departures.length))], destination: destinations[Math.floor(index / departures.length) % destinations.length], departure: departures[index % departures.length] };
}

export async function runBoundedMatrix(total: number, concurrency: number, task: (index: number) => Promise<void>, signal?: AbortSignal) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(total) || total < 0) throw new Error('Invalid matrix bounds');
  let next = 0; let failed = false; let firstError: unknown;
  const workers = Array.from({length: Math.min(total, concurrency)}, async () => {
    while (!signal?.aborted && !failed) {
      const index = next++;
      if (index >= total) return;
      try { await task(index); } catch (error) { failed = true; firstError ??= error; return; }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
}

/** Fixed 60,002-bin histogram; last bin represents >=60,001 ms. */
export class LatencyHistogram {
  private bins = new Uint32Array(60002);
  count = 0;
  sum = 0;
  add(ms: number) { this.bins[Math.min(60001, Math.max(0, Math.ceil(ms)))]++; this.count++; this.sum += ms; }
  percentile(fraction: number) {
    let cumulative = 0;
    for (let index = 0; index < this.bins.length; index++) {
      cumulative += this.bins[index];
      if (cumulative >= Math.ceil(this.count * fraction)) return index;
    }
    return 0;
  }
}

/** Merge by GTFS primary key, retaining shared stations and identical calendars once. */
export function mergeGtfsPackages(packages: Record<string,string>[]): Record<string,string> {
  const tables = new Map<string,{header:string[]; rows:Map<string,string[]>}>();
  for (const files of packages) for (const [name, csv] of Object.entries(files)) {
    if (!name.endsWith('.txt')) continue;
    const [header, ...rows] = parseDelimited(csv, ',');
    if (!header) continue;
    let table = tables.get(name);
    if (!table) { table = {header, rows:new Map()}; tables.set(name,table); }
    if (JSON.stringify(table.header) !== JSON.stringify(header)) throw new Error(`Header conflict: ${name}`);
    for (const row of rows.filter(row=>row.some(Boolean))) {
      const key = name === 'stop_times.txt' ? `${row[0]}:${row[header.indexOf('stop_sequence')]}` : name === 'calendar_dates.txt' ? `${row[0]}:${row[1]}` : row[header.indexOf(name === 'trips.txt' ? 'trip_id' : header[0])];
      const previous = table.rows.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`GTFS key conflict: ${name} ${key}`);
      table.rows.set(key,row);
    }
  }
  const encode = (value:string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"','""')}"` : value;
  return Object.fromEntries([...tables].map(([name, table])=>[name,[table.header,...table.rows.values()].map(row=>row.map(encode).join(',')).join('\r\n')+'\r\n']));
}


