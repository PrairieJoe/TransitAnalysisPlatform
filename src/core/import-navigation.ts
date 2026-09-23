export function nextViewAfterImport(action: 'analysis' | 'gtfs' | 'alighting'): 'report' | 'synthetic' | 'alighting' {
  if (action === 'alighting') return 'alighting';
  return action === 'gtfs' ? 'synthetic' : 'report';
}

export type ImportAction = 'analysis' | 'gtfs' | 'alighting';

export interface ImportActionLayout {
  primary: ImportAction;
  secondary: ImportAction[];
}

export function getImportActionLayout(input: { coreMappingReady: boolean; routeStopMasterCount: number }): ImportActionLayout {
  if (input.coreMappingReady && input.routeStopMasterCount > 0) {
    return { primary: 'alighting', secondary: ['analysis', 'gtfs'] };
  }
  return { primary: 'analysis', secondary: [] };
}
