import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CreateTaskInput,
  ProviderId,
  SubscriptionAccount,
  SwitchboardTask,
  UpdateTaskInput,
} from '@switchboard/core';
import { AdapterRegistry, collectSubscriptions } from './adapters/registry.js';
import { AdapterRefreshError } from './adapters/types.js';
import { buildAdapterRefreshConflictDetail } from './adapter-conflict.js';
import { BrokerAuthPolicy, type BrokerMutationScope } from './auth-policy.js';
import { buildDashboardSnapshot } from './dashboard.js';
import {
  buildMethodNotAllowedResponse,
} from './error-response.js';
import {
  buildBadRequestHttpResponse,
  buildConflictHttpResponse,
  buildForbiddenHttpResponse,
  buildInternalErrorHttpResponse,
  buildNotFoundHttpResponse,
  buildUnauthorizedHttpResponse,
} from './error-http-response.js';
import { buildBrokerFailureResponse } from './failure-response.js';
import { buildBrokerHealthSnapshot } from './health.js';
import { loadProjectProfiles } from './profile-loader.js';
import { resolveBrokerProjectProfile } from './profile-resolution.js';
import { authorizeBrokerMutationRequest } from './mutation-authorization.js';
import { buildProjectRefreshSnapshot } from './refresh-snapshot.js';
import { buildBrokerJsonResponse, buildMethodNotAllowedHttpResponse } from './response-envelope.js';
import {
  readJsonRequestBody,
} from './request-body.js';
import { allowedMethodsForBrokerRoute, matchBrokerRoute } from './route-contract.js';
import { buildProjectStateSnapshot } from './state-snapshot.js';
import { FileStateStore } from './state-store.js';
import { buildTaskSnapshot } from './task-snapshot.js';
import {
  assertKnownKeys,
  expectArray,
  expectBoolean,
  expectEnum,
  expectNumber,
  expectOptionalString,
  expectRecord,
  expectString,
} from './validation.js';
import { buildProjectAdaptersSnapshot } from './adapters-snapshot.js';
import { buildProjectProfilesSnapshot } from './profiles-snapshot.js';
import {
  loadBrokerRuntimeConfig,
  type BrokerRuntimeConfig,
  type BrokerRuntimeOptions,
} from './runtime-config.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const taskPriorities = ['p0', 'p1', 'p2', 'p3'] as const;
const taskStatuses = ['queued', 'planned', 'running', 'review', 'blocked', 'completed', 'failed'] as const;
const availabilityStates = ['available', 'constrained', 'unavailable', 'unknown'] as const;
const authModes = ['subscription', 'api', 'hybrid'] as const;
const usageUnits = ['requests', 'messages', 'minutes', 'credits', 'tokens', 'unknown'] as const;
const usageSources = ['manual', 'cli', 'provider-ui', 'api', 'inferred'] as const;
const confidenceLevels = ['low', 'medium', 'high'] as const;
const quotaInterpretations = ['absolute', 'percentage_window', 'informational'] as const;
const artifactTypes = ['spec', 'diff', 'doc', 'log', 'result', 'other'] as const;

export type BrokerServer = http.Server | https.Server;
export type BrokerServerOptions = Partial<BrokerRuntimeOptions>;

function json(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const nextResponse = buildBrokerJsonResponse(statusCode, payload);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function notFound(response: http.ServerResponse, detail: string): void {
  const nextResponse = buildNotFoundHttpResponse(detail);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function badRequest(response: http.ServerResponse, detail: string): void {
  const nextResponse = buildBadRequestHttpResponse(detail);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function unauthorized(response: http.ServerResponse, detail: string): void {
  const nextResponse = buildUnauthorizedHttpResponse(detail);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function forbidden(response: http.ServerResponse, detail: string): void {
  const nextResponse = buildForbiddenHttpResponse(detail);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function conflict(response: http.ServerResponse, detail: string): void {
  const nextResponse = buildConflictHttpResponse(detail);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function methodNotAllowed(response: http.ServerResponse, allowed: string[]): void {
  const nextResponse = buildMethodNotAllowedHttpResponse(allowed);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function internalError(response: http.ServerResponse, error: unknown): void {
  const nextResponse = buildInternalErrorHttpResponse(error);
  response.writeHead(nextResponse.statusCode, nextResponse.headers);
  response.end(nextResponse.body);
}

function parseTaskInput(raw: unknown): CreateTaskInput {
  const record = expectRecord(raw, 'task');

  return {
    title: expectString(record.title, 'task.title'),
    description: expectString(record.description, 'task.description'),
    priority: expectEnum(record.priority, taskPriorities, 'task.priority'),
    role: expectString(record.role, 'task.role'),
    status: record.status === undefined ? undefined : expectEnum(record.status, taskStatuses, 'task.status'),
    assignee: expectOptionalString(record.assignee, 'task.assignee'),
    approvalRequired: record.approvalRequired === undefined ? undefined : expectBoolean(record.approvalRequired, 'task.approvalRequired'),
    approvalNote: expectOptionalString(record.approvalNote, 'task.approvalNote'),
    reservations: record.reservations === undefined ? undefined : parseReservations(record.reservations),
    artifacts: record.artifacts === undefined ? undefined : parseArtifacts(record.artifacts),
    dependsOn: record.dependsOn === undefined ? undefined : expectArray(record.dependsOn, 'task.dependsOn').map((entry, index) =>
      expectString(entry, `task.dependsOn[${index}]`),
    ),
  };
}

function parseReservations(raw: unknown): CreateTaskInput['reservations'] {
  return expectArray(raw, 'task.reservations').map((entry, index) => {
    const record = expectRecord(entry, `task.reservations[${index}]`);

    return {
      provider: expectString(record.provider, `task.reservations[${index}].provider`),
      modelId: expectString(record.modelId, `task.reservations[${index}].modelId`),
      estimatedCost: expectNumber(record.estimatedCost, `task.reservations[${index}].estimatedCost`),
      usageUnit: expectEnum(record.usageUnit, usageUnits, `task.reservations[${index}].usageUnit`),
      reason: expectString(record.reason, `task.reservations[${index}].reason`),
    };
  });
}

function parseArtifacts(raw: unknown): CreateTaskInput['artifacts'] {
  return expectArray(raw, 'task.artifacts').map((entry, index) => {
    const record = expectRecord(entry, `task.artifacts[${index}]`);

    return {
      id: expectString(record.id, `task.artifacts[${index}].id`),
      type: expectEnum(record.type, artifactTypes, `task.artifacts[${index}].type`),
      uri: expectString(record.uri, `task.artifacts[${index}].uri`),
      summary: expectString(record.summary, `task.artifacts[${index}].summary`),
    };
  });
}

function parseSubscriptionSignals(raw: unknown): NonNullable<SubscriptionAccount['signals']> {
  return expectArray(raw, 'subscription.signals').map((entry, index) => {
    const record = expectRecord(entry, `subscription.signals[${index}]`);

    return {
      id: expectString(record.id, `subscription.signals[${index}].id`),
      label: expectString(record.label, `subscription.signals[${index}].label`),
      value: expectString(record.value, `subscription.signals[${index}].value`),
    };
  });
}

function parseSubscriptions(raw: unknown): SubscriptionAccount[] {
  return expectArray(raw, 'subscriptions').map((entry, index) => {
    const record = expectRecord(entry, `subscriptions[${index}]`);

    return {
      id: expectString(record.id, `subscriptions[${index}].id`),
      provider: expectString(record.provider, `subscriptions[${index}].provider`),
      displayName: expectString(record.displayName, `subscriptions[${index}].displayName`),
      authMode: expectEnum(record.authMode, authModes, `subscriptions[${index}].authMode`),
      owner: expectString(record.owner, `subscriptions[${index}].owner`),
      signals: record.signals === undefined ? undefined : parseSubscriptionSignals(record.signals),
      quotas: expectArray(record.quotas, `subscriptions[${index}].quotas`).map((quotaEntry, quotaIndex) => {
        const quota = expectRecord(quotaEntry, `subscriptions[${index}].quotas[${quotaIndex}]`);

        return {
          provider: expectString(quota.provider, `subscriptions[${index}].quotas[${quotaIndex}].provider`),
          modelId: expectString(quota.modelId, `subscriptions[${index}].quotas[${quotaIndex}].modelId`),
          displayName: expectString(quota.displayName, `subscriptions[${index}].quotas[${quotaIndex}].displayName`),
          availability: expectEnum(
            quota.availability,
            availabilityStates,
            `subscriptions[${index}].quotas[${quotaIndex}].availability`,
          ),
          authMode: expectEnum(quota.authMode, authModes, `subscriptions[${index}].quotas[${quotaIndex}].authMode`),
          usageUnit: expectEnum(quota.usageUnit, usageUnits, `subscriptions[${index}].quotas[${quotaIndex}].usageUnit`),
          source: expectEnum(quota.source, usageSources, `subscriptions[${index}].quotas[${quotaIndex}].source`),
          confidence: expectEnum(
            quota.confidence,
            confidenceLevels,
            `subscriptions[${index}].quotas[${quotaIndex}].confidence`,
          ),
          limit: quota.limit === undefined ? undefined : expectNumber(quota.limit, `subscriptions[${index}].quotas[${quotaIndex}].limit`),
          used: quota.used === undefined ? undefined : expectNumber(quota.used, `subscriptions[${index}].quotas[${quotaIndex}].used`),
          remaining: quota.remaining === undefined
            ? undefined
            : expectNumber(quota.remaining, `subscriptions[${index}].quotas[${quotaIndex}].remaining`),
          interpretation: quota.interpretation === undefined
            ? undefined
            : expectEnum(
                quota.interpretation,
                quotaInterpretations,
                `subscriptions[${index}].quotas[${quotaIndex}].interpretation`,
              ),
          resetAt: expectOptionalString(quota.resetAt, `subscriptions[${index}].quotas[${quotaIndex}].resetAt`),
          notes: expectOptionalString(quota.notes, `subscriptions[${index}].quotas[${quotaIndex}].notes`),
        };
      }),
    };
  });
}

function parseRefreshRequest(raw: unknown): { providers?: ProviderId[] } {
  const record = expectRecord(raw, 'refreshRequest');
  assertKnownKeys(record, ['provider', 'providers'], 'refreshRequest');

  if (record.provider !== undefined && record.providers !== undefined) {
    throw new Error('refreshRequest must not specify both provider and providers.');
  }

  if (record.provider !== undefined) {
    return {
      providers: [expectString(record.provider, 'refreshRequest.provider')],
    };
  }

  if (record.providers !== undefined) {
    return {
      providers: expectArray(record.providers, 'refreshRequest.providers').map((entry, index) =>
        expectString(entry, `refreshRequest.providers[${index}]`),
      ),
    };
  }

  return {};
}

function parsePatchText(value: unknown, context: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${context} must be a string or null.`);
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseTaskUpdateInput(raw: unknown): UpdateTaskInput {
  const record = expectRecord(raw, 'taskPatch');
  const allowedKeys = new Set(['title', 'description', 'priority', 'role', 'status', 'assignee', 'blockedReason', 'approvalRequired', 'approvedBy', 'approvalNote']);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`taskPatch.${key} is not allowed.`);
    }
  }

  if (Object.keys(record).length === 0) {
    throw new Error('taskPatch must include at least one editable field.');
  }

  const update: UpdateTaskInput = {};

  if (Object.prototype.hasOwnProperty.call(record, 'title')) {
    update.title = expectString(record.title, 'taskPatch.title');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'description')) {
    update.description = expectString(record.description, 'taskPatch.description');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'priority')) {
    update.priority = expectEnum(record.priority, taskPriorities, 'taskPatch.priority');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'role')) {
    update.role = expectString(record.role, 'taskPatch.role');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'status')) {
    update.status = expectEnum(record.status, taskStatuses, 'taskPatch.status');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'assignee')) {
    update.assignee = parsePatchText(record.assignee, 'taskPatch.assignee');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'blockedReason')) {
    update.blockedReason = parsePatchText(record.blockedReason, 'taskPatch.blockedReason');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'approvalRequired')) {
    update.approvalRequired = expectBoolean(record.approvalRequired, 'taskPatch.approvalRequired');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'approvedBy')) {
    update.approvedBy = parsePatchText(record.approvedBy, 'taskPatch.approvedBy');
  }

  if (Object.prototype.hasOwnProperty.call(record, 'approvalNote')) {
    update.approvalNote = parsePatchText(record.approvalNote, 'taskPatch.approvalNote');
  }

  return update;
}

function authorizeMutationRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  authPolicy: BrokerAuthPolicy,
  scope: BrokerMutationScope,
): boolean {
  const authorization = authorizeBrokerMutationRequest(request, authPolicy, scope);
  if (authorization.ok) {
    return true;
  }

  json(response, authorization.statusCode, authorization.payload);
  return false;
}

export function createBrokerServer(config: BrokerRuntimeConfig): BrokerServer {
  const stateStore = new FileStateStore(config.stateDir);
  const adapterRegistry = new AdapterRegistry(config.snapshotDir);
  const authPolicy = new BrokerAuthPolicy({
    host: config.host,
    operatorToken: config.operatorToken,
    manualSubscriptionReplaceEnabled: config.manualSubscriptionReplaceEnabled,
  });

  const requestHandler: http.RequestListener = async (request, response) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `${config.summary.protocol}://switchboard.local`);

    try {
      const route = matchBrokerRoute(url.pathname);
      if (!route) {
        notFound(response, `No route for ${method} ${url.pathname}.`);
        return;
      }

      if (route.kind === 'health') {
        if (method !== 'GET') {
          methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
          return;
        }

        json(response, 200, buildBrokerHealthSnapshot(authPolicy, config.summary));
        return;
      }

      if (route.kind === 'profiles') {
        if (method !== 'GET') {
          methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
          return;
        }

        const profiles = await loadProjectProfiles(config.profilesDir);
        json(response, 200, buildProjectProfilesSnapshot(profiles));
        return;
      }

      const profileResolution = await resolveBrokerProjectProfile(config.profilesDir, route.profileId);
      if (!profileResolution.ok) {
        json(response, profileResolution.statusCode ?? 404, profileResolution.payload);
        return;
      }
      const profile = profileResolution.profile;

      switch (route.kind) {
        case 'project-state':
          if (method !== 'GET') {
            methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
            return;
          }

          json(response, 200, buildProjectStateSnapshot(await stateStore.load(profile)));
          return;
        case 'project-dashboard':
          if (method !== 'GET') {
            methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
            return;
          }

          json(response, 200, buildDashboardSnapshot(await stateStore.load(profile)));
          return;
        case 'project-adapters':
          if (method !== 'GET') {
            methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
            return;
          }

          json(response, 200, buildProjectAdaptersSnapshot(await adapterRegistry.listForProfile(profile)));
          return;
        case 'project-tasks':
          if (method !== 'POST') {
            methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
            return;
          }

          if (!authorizeMutationRoute(request, response, authPolicy, 'taskCreate')) {
            return;
          }

          {
            const payload = await readJsonRequestBody(request);
            const nextState = await stateStore.createTask(profile, parseTaskInput(payload));
            json(response, 201, buildDashboardSnapshot(nextState));
          }
          return;
        case 'project-task':
          if (method === 'GET') {
            json(response, 200, buildTaskSnapshot(await stateStore.getTask(profile, route.taskId)));
            return;
          }

          if (method !== 'PATCH') {
            methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
            return;
          }

          if (!authorizeMutationRoute(request, response, authPolicy, 'taskUpdate')) {
            return;
          }

          {
            const payload = await readJsonRequestBody(request);
            const nextState = await stateStore.updateTask(profile, route.taskId, parseTaskUpdateInput(payload));
            json(response, 200, buildDashboardSnapshot(nextState));
          }
          return;
        case 'project-subscriptions':
          if (method !== 'PUT') {
            methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
            return;
          }

          if (!authorizeMutationRoute(request, response, authPolicy, 'subscriptionReplace')) {
            return;
          }

          {
            const payload = expectRecord(await readJsonRequestBody(request), 'payload');
            const subscriptions = parseSubscriptions(payload.subscriptions);
            const nextState = await stateStore.replaceSubscriptions(profile, subscriptions);
            json(response, 200, buildDashboardSnapshot(nextState));
          }
          return;
        case 'project-subscriptions-refresh':
          if (method !== 'POST') {
            methodNotAllowed(response, allowedMethodsForBrokerRoute(route));
            return;
          }

          if (!authorizeMutationRoute(request, response, authPolicy, 'subscriptionRefresh')) {
            return;
          }

          {
            const payload = await readJsonRequestBody(request);
            const refreshRequest = parseRefreshRequest(payload);
            const results = await adapterRegistry.refreshProviders(profile, refreshRequest.providers);
            const nextState = await stateStore.replaceSubscriptionsForProviders(
              profile,
              results.map((result) => result.provider),
              collectSubscriptions(results),
            );
            json(response, 200, buildProjectRefreshSnapshot(nextState, results));
          }
          return;
        default:
          notFound(response, `No route for ${method} ${url.pathname}.`);
          return;
      }
    } catch (error) {
      const failure = buildBrokerFailureResponse(error);
      json(response, failure.statusCode, failure.payload);
    }
  };

  if (config.tls) {
    try {
      return https.createServer({
        cert: config.tls.cert,
        key: config.tls.key,
        ca: config.tls.ca,
      }, requestHandler);
    } catch {
      throw new Error('Invalid TLS certificate or key material.');
    }
  }

  return http.createServer(requestHandler);
}

export async function createBrokerServerFromEnvironment(options: BrokerServerOptions = {}): Promise<{
  config: BrokerRuntimeConfig;
  server: BrokerServer;
}> {
  const config = await loadBrokerRuntimeConfig({
    host: options.host,
    port: options.port,
    profilesDir: options.profilesDir ?? process.env.SWITCHBOARD_PROFILES_DIR ?? path.join(repoRoot, 'profiles'),
    stateDir: options.stateDir ?? process.env.SWITCHBOARD_STATE_DIR ?? path.join(repoRoot, '.switchboard', 'state'),
    snapshotDir: options.snapshotDir ?? process.env.SWITCHBOARD_SNAPSHOT_DIR ?? path.join(repoRoot, '.switchboard', 'provider-snapshots'),
    operatorToken: options.operatorToken,
  });

  return {
    config,
    server: createBrokerServer(config),
  };
}
