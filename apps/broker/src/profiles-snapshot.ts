import type { ProjectProfile, ProjectProfilesSnapshot } from '@switchboard/core';

export function buildProjectProfilesSnapshot(
  profiles: ProjectProfile[],
): ProjectProfilesSnapshot {
  return {
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      repoCount: profile.repos.length,
      roleCount: profile.roles.length,
    })),
  };
}
