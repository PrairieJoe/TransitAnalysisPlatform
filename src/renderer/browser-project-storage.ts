import type { ProjectManifest } from '../shared/types';

const DATABASE_NAME = 'transit-analysis-platform';
const DATABASE_VERSION = 1;
const STORE_NAME = 'projects';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('브라우저 프로젝트 저장소를 읽지 못했습니다.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('브라우저 프로젝트 저장소를 열지 못했습니다.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await requestResult(operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
  } finally {
    database.close();
  }
}

export async function listBrowserProjects(): Promise<ProjectManifest[]> {
  return withStore('readonly', (store) => store.getAll() as IDBRequest<ProjectManifest[]>);
}

export async function saveBrowserProject(project: ProjectManifest): Promise<void> {
  await withStore('readwrite', (store) => store.put(project));
}

export async function deleteBrowserProject(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}
