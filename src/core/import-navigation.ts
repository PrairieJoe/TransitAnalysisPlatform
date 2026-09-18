export function nextViewAfterImport(action: 'analysis' | 'gtfs' | 'alighting'): 'report' | 'synthetic' | 'alighting' {
  if (action === 'alighting') return 'alighting';
  return action === 'gtfs' ? 'synthetic' : 'report';
}
