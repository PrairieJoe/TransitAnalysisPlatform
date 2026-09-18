import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import type { MotisStatus } from '../shared/types';

export interface MotisSidecarOptions {
  executablePath: string;
  dataDirectory: string;
  osmPbfPath: string;
  port: number;
  args: string[];
  environment?: NodeJS.ProcessEnv;
  disableTiles?: boolean;
  healthPath: string;
  startupTimeoutMs: number;
}

type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
type FetchFunction = typeof fetch;

interface MotisSidecarDependencies {
  spawn?: SpawnFunction;
  fetch?: FetchFunction;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  stopTimeoutMs?: number;
}

export interface MotisPreparationResult {
  archivePath: string;
  message: string;
}

type RunCommandFunction = (executablePath: string, args: string[], cwd: string, environment?: NodeJS.ProcessEnv) => Promise<void>;

export interface MotisPreparationDependencies {
  runCommand?: RunCommandFunction;
}

const MISSING_EMBEDDED_MOTIS_MESSAGE = '앱 내장 MOTIS 구성요소를 찾을 수 없습니다. 앱을 다시 설치하세요.';

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function normalizeHealthPath(value: string): string {
  const trimmed = value.trim();
  return trimmed ? (trimmed.startsWith('/') ? trimmed : `/${trimmed}`) : '/api/v1/health';
}

function validateOptions(options: MotisSidecarOptions): string | undefined {
  if (!options.executablePath.trim()) return MISSING_EMBEDDED_MOTIS_MESSAGE;
  if (!options.dataDirectory.trim()) return 'MOTIS 데이터 디렉터리를 입력하세요.';
  if (!options.osmPbfPath.trim()) return '지역 OSM PBF 경로를 입력하세요.';
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) return 'MOTIS 포트는 1~65535 사이 정수여야 합니다.';
  if (!Array.isArray(options.args) || options.args.some((argument) => typeof argument !== 'string')) return 'MOTIS 서버 인자가 유효하지 않습니다.';
  if (!Number.isInteger(options.startupTimeoutMs) || options.startupTimeoutMs < 500) return 'MOTIS 시작 제한시간은 500ms 이상이어야 합니다.';
  return undefined;
}

export function assertLocalMotisRequestPath(path: unknown, activeBaseUrl?: string): asserts path is string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('MOTIS 요청 경로는 활성 127.0.0.1 로컬 API 절대 경로여야 합니다.');
  }
  if (activeBaseUrl) {
    const activeUrl = new URL(activeBaseUrl);
    if (activeUrl.protocol !== 'http:' || activeUrl.hostname !== '127.0.0.1') {
      throw new Error('MOTIS 요청 경로는 활성 127.0.0.1 로컬 API 절대 경로여야 합니다.');
    }
    const activeOrigin = activeUrl.origin;
    const resolvedOrigin = new URL(path, activeUrl).origin;
    if (resolvedOrigin !== activeOrigin) {
      throw new Error('MOTIS 요청 경로는 활성 127.0.0.1 로컬 API 절대 경로여야 합니다.');
    }
  }
}

export class MotisSidecar {
  private readonly spawnProcess: SpawnFunction;
  private readonly fetchImpl: FetchFunction;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly stopTimeoutMs: number;
  private process: ChildProcess | null = null;
  private generation = 0;
  private baseUrl: string | undefined;
  private failureMessage: string | undefined;
  private status: MotisStatus = { state: 'stopped' };
  private diagnostics: string[] = [];
  private lifecycle: Promise<unknown> = Promise.resolve();
  private lifecycleBusy = false;

  constructor(dependencies: MotisSidecarDependencies = {}) {
    this.spawnProcess = dependencies.spawn ?? ((command, args, options) => spawn(command, args, options));
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = dependencies.now ?? (() => Date.now());
    this.stopTimeoutMs = dependencies.stopTimeoutMs ?? 2000;
  }

  start(options: MotisSidecarOptions): Promise<MotisStatus> {
    return this.enqueueLifecycle(() => this.startInternal(options));
  }

  private async startInternal(options: MotisSidecarOptions): Promise<MotisStatus> {
    if (this.status.state === 'ready' && this.baseUrl) return this.status;
    const invalidMessage = validateOptions(options);
    if (invalidMessage) return this.fail(invalidMessage);
    await this.stopInternal();
    const generation = ++this.generation;
    const baseUrl = `http://127.0.0.1:${options.port}`;
    this.baseUrl = baseUrl;
    this.failureMessage = undefined;
    this.diagnostics = [];
    this.status = { state: 'starting', baseUrl, message: 'MOTIS 서버를 시작하는 중입니다.' };
    try {
      const child = this.spawnProcess(options.executablePath, options.args, {
        cwd: options.dataDirectory,
        env: { ...process.env, ...options.environment },
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.process = child;
      child.stdout?.on('data', (chunk: Buffer | string) => this.recordDiagnostic(chunk));
      child.stderr?.on('data', (chunk: Buffer | string) => this.recordDiagnostic(chunk));
      child.once('error', (error) => {
        if (generation !== this.generation) return;
        this.failureMessage = isEnoent(error)
          ? MISSING_EMBEDDED_MOTIS_MESSAGE
          : `MOTIS 프로세스 오류: ${asErrorMessage(error)}`;
        this.status = { state: 'failed', baseUrl, message: this.failureMessage };
      });
      child.once('exit', (code, signal) => {
        if (generation !== this.generation || this.status.state === 'stopped') return;
        this.failureMessage = `MOTIS 프로세스가 준비 전에 종료되었습니다. code=${code ?? 'null'}, signal=${signal ?? 'null'}${this.diagnosticSuffix()}`;
        this.status = { state: 'failed', baseUrl, message: this.failureMessage };
      });
    } catch (error) {
      return this.fail(`MOTIS 프로세스를 시작하지 못했습니다: ${asErrorMessage(error)}`);
    }

    const deadline = this.now() + options.startupTimeoutMs;
    let lastHealthError = '';
    const healthPath = normalizeHealthPath(options.healthPath);
    while (this.now() <= deadline) {
      if (generation !== this.generation) return { state: 'stopped' };
      if (this.failureMessage) return this.fail(this.failureMessage);
      try {
        const response = await this.fetchImpl(`${baseUrl}${healthPath}`);
        if (response.ok) {
          this.status = { state: 'ready', baseUrl, message: 'MOTIS 서버가 준비되었습니다.' };
          return this.status;
        }
        lastHealthError = `health HTTP ${response.status}`;
      } catch (error) {
        lastHealthError = asErrorMessage(error);
      }
      if (generation !== this.generation) return { state: 'stopped' };
      await this.sleep(Math.min(250, Math.max(25, deadline - this.now())));
    }
    return this.fail(`MOTIS readiness 확인 시간이 초과되었습니다. ${lastHealthError || 'health endpoint 응답 없음'}${this.diagnosticSuffix()}`);
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.baseUrl || this.status.state !== 'ready') throw new Error('MOTIS가 준비되지 않았습니다. 먼저 MOTIS 상태 확인을 실행하세요.');
    assertLocalMotisRequestPath(path, this.baseUrl);
    const url = new URL(path, this.baseUrl).toString();
    const response = await this.fetchImpl(url, init);
    const body = await response.text();
    if (!response.ok) throw new Error(`MOTIS HTTP ${response.status}: ${body.slice(0, 500)}`);
    if (!body.trim()) return undefined as T;
    try { return JSON.parse(body) as T; } catch { return body as T; }
  }

  stop(): Promise<void> {
    return this.enqueueLifecycle(() => this.stopInternal());
  }

  private async stopInternal(): Promise<void> {
    this.generation += 1;
    const child = this.process;
    this.process = null;
    this.baseUrl = undefined;
    this.failureMessage = undefined;
    this.status = { state: 'stopped' };
    if (!child) return;
    if (child.exitCode !== null && child.exitCode !== undefined || child.signalCode !== null && child.signalCode !== undefined) return;
    try { if (!child.killed) child.kill(); } catch { /* process already exited */ }
    await this.waitForChildExit(child);
  }

  getStatus(): MotisStatus { return this.status; }

  private async fail(message: string): Promise<MotisStatus> {
    this.generation += 1;
    const child = this.process;
    this.process = null;
    const baseUrl = this.baseUrl;
    this.baseUrl = undefined;
    this.failureMessage = undefined;
    this.status = { state: 'stopped' };
    if (child) {
      if (child.exitCode === null || child.exitCode === undefined) {
        try { if (!child.killed) child.kill(); } catch { /* process already exited */ }
        await this.waitForChildExit(child);
      }
    }
    this.status = { state: 'failed', baseUrl, message };
    return this.status;
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleBusy ? this.lifecycle.then(operation, operation) : operation();
    this.lifecycleBusy = true;
    const next = result.then(() => undefined, () => undefined);
    this.lifecycle = next;
    void next.then(() => {
      if (this.lifecycle === next) this.lifecycleBusy = false;
    });
    return result;
  }

  private waitForChildExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null && child.exitCode !== undefined || child.signalCode !== null && child.signalCode !== undefined) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(finish, this.stopTimeoutMs);
      child.once('exit', finish);
    });
  }

  private recordDiagnostic(chunk: Buffer | string): void {
    const lines = String(chunk).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    this.diagnostics = [...this.diagnostics, ...lines].slice(-20);
  }

  private diagnosticSuffix(): string {
    return this.diagnostics.length ? ` 최근 로그: ${this.diagnostics.slice(-3).join(' | ')}` : '';
  }
}

function runOneShotCommand(executablePath: string, args: string[], cwd: string, environment?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    let outputBytes = 0;
    let child: ChildProcess;
    try {
      child = spawn(executablePath, args, { cwd, env: { ...process.env, ...environment }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new Error(isEnoent(error) ? MISSING_EMBEDDED_MOTIS_MESSAGE : `MOTIS 명령을 실행하지 못했습니다: ${asErrorMessage(error)}`));
      return;
    }
    child.stdout?.on('data', (chunk: Buffer | string) => { output += String(chunk); outputBytes += Buffer.byteLength(String(chunk)); });
    child.stderr?.on('data', (chunk: Buffer | string) => { output += String(chunk); outputBytes += Buffer.byteLength(String(chunk)); });
    child.once('error', (error) => reject(new Error(isEnoent(error) ? MISSING_EMBEDDED_MOTIS_MESSAGE : `MOTIS 명령 오류: ${asErrorMessage(error)}`)));
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`MOTIS 명령이 실패했습니다 (${args.join(' ')}), code=${code ?? 'null'}, signal=${signal ?? 'null'}, outputBytes=${outputBytes}: ${output.trim().slice(-800)}`)));
  });
}

function removeTilesSection(configText: string): string {
  const lines = configText.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (!skipping && /^tiles:\s*$/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() && !/^\s/.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

export async function prepareMotisData(options: MotisSidecarOptions, files: GtfsFileSet, dependencies: MotisPreparationDependencies = {}): Promise<MotisPreparationResult> {
  const invalidMessage = validateOptions(options);
  if (invalidMessage) throw new Error(invalidMessage);
  if (!existsSync(options.osmPbfPath)) throw new Error(`OSM PBF 파일을 찾을 수 없습니다: ${options.osmPbfPath}`);
  await mkdir(options.dataDirectory, { recursive: true });
  const archivePath = join(options.dataDirectory, 'tap-synthetic-gtfs.zip');
  const zip = new JSZip();
  Object.entries(files).forEach(([name, content]) => zip.file(name, content));
  await writeFile(archivePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const runCommand = dependencies.runCommand ?? runOneShotCommand;
  await runCommand(options.executablePath, ['config', options.osmPbfPath, archivePath], options.dataDirectory, options.environment);
  if (options.disableTiles) {
    const configPath = join(options.dataDirectory, 'config.yml');
    const configText = await readFile(configPath, 'utf8');
    await writeFile(configPath, removeTilesSection(configText), 'utf8');
  }
  await runCommand(options.executablePath, ['import', '-c', join(options.dataDirectory, 'config.yml'), '-d', join(options.dataDirectory, 'data')], dirname(options.executablePath), options.environment);
  return { archivePath, message: `Synthetic GTFS를 MOTIS에 import했습니다: ${archivePath}` };
}
