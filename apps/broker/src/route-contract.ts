export type BrokerRouteMatch =
  | { kind: 'health' }
  | { kind: 'profiles' }
  | { kind: 'project-state'; profileId: string }
  | { kind: 'project-dashboard'; profileId: string }
  | { kind: 'project-adapters'; profileId: string }
  | { kind: 'project-tasks'; profileId: string }
  | { kind: 'project-task'; profileId: string; taskId: string }
  | { kind: 'project-subscriptions'; profileId: string }
  | { kind: 'project-subscriptions-refresh'; profileId: string };

export function matchBrokerRoute(pathname: string): BrokerRouteMatch | null {
  if (pathname === '/healthz') {
    return { kind: 'health' };
  }

  if (pathname === '/v1/profiles') {
    return { kind: 'profiles' };
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || !segments[2]) {
    return null;
  }

  const profileId = segments[2];
  const resource = segments[3];
  const resourceId = segments[4];

  if (segments.length === 4) {
    switch (resource) {
      case 'state':
        return { kind: 'project-state', profileId };
      case 'dashboard':
        return { kind: 'project-dashboard', profileId };
      case 'adapters':
        return { kind: 'project-adapters', profileId };
      case 'tasks':
        return { kind: 'project-tasks', profileId };
      case 'subscriptions':
        return { kind: 'project-subscriptions', profileId };
      default:
        return null;
    }
  }

  if (segments.length === 5 && resource === 'tasks' && resourceId) {
    return { kind: 'project-task', profileId, taskId: resourceId };
  }

  if (segments.length === 5 && resource === 'subscriptions' && resourceId === 'refresh') {
    return { kind: 'project-subscriptions-refresh', profileId };
  }

  return null;
}

export function allowedMethodsForBrokerRoute(route: BrokerRouteMatch): string[] {
  switch (route.kind) {
    case 'health':
    case 'profiles':
    case 'project-state':
    case 'project-dashboard':
    case 'project-adapters':
      return ['GET'];
    case 'project-tasks':
      return ['POST'];
    case 'project-task':
      return ['GET', 'PATCH'];
    case 'project-subscriptions':
      return ['PUT'];
    case 'project-subscriptions-refresh':
      return ['POST'];
    default:
      return [];
  }
}
