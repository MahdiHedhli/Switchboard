import type { BrokerErrorResponse, ProjectProfile } from '@switchboard/core';
import { buildBrokerErrorResponse } from './error-response.js';
import { loadProjectProfile } from './profile-loader.js';

export type BrokerProfileResolutionResult =
  | {
      ok: true;
      profile: ProjectProfile;
    }
  | {
      ok: false;
      statusCode: 404;
      payload: BrokerErrorResponse;
    };

export function buildUnknownProjectProfileDetail(profileId: string): string {
  return `Unknown project profile "${profileId}".`;
}

export async function resolveBrokerProjectProfile(
  profilesDir: string,
  profileId: string,
): Promise<BrokerProfileResolutionResult> {
  const profile = await loadProjectProfile(profilesDir, profileId);
  if (!profile) {
    return {
      ok: false,
      statusCode: 404,
      payload: buildBrokerErrorResponse('not_found', buildUnknownProjectProfileDetail(profileId)),
    };
  }

  return {
    ok: true,
    profile,
  };
}
