export type Tab = 'files' | 'comments';

export interface Route {
  tab: Tab;
  file: string | null;
}

export function parseRoute(hash: string): Route {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return {
    tab: params.get('tab') === 'comments' ? 'comments' : 'files',
    file: params.get('file') || null,
  };
}

export function formatRoute(route: Route): string {
  const params = new URLSearchParams();
  params.set('tab', route.tab);
  if (route.file !== null) params.set('file', route.file);
  return `#${params.toString()}`;
}
