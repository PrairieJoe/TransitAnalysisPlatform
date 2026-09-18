export function nextViewAfterImport(action: 'analysis' | 'gtfs'): 'report' | 'synthetic' {
  return action === 'gtfs' ? 'synthetic' : 'report';
}
