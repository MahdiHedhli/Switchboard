/* "Planning notes" panel: static guidance, planner warnings, and the
 * refresh/load/mutation status lines. */
import {
  formatPlannerWarningPills,
  formatPlannerWarningTitle,
  plannerWarningKey,
} from '@switchboard/core';
import type { ProjectDashboardSnapshot } from '@switchboard/core';
import { planningNotes } from '../lib/constants';

type PlanningNotesPanelProps = {
  warnings: ProjectDashboardSnapshot['plan']['warnings'];
  refreshMessage: string | null;
  refreshMessageAdvisory: boolean;
  loadError: string | null;
  mutationError: string | null;
};

export function PlanningNotesPanel({
  warnings,
  refreshMessage,
  refreshMessageAdvisory,
  loadError,
  mutationError,
}: PlanningNotesPanelProps) {
  return (
    <section className="panel">
      <h2>Planning notes</h2>
      <ul>
        {planningNotes.map((note) => <li key={note}>{note}</li>)}
      </ul>
      {warnings.length > 0 ? (
        <div className="stack">
          {warnings.map((warning) => (
            <article className="card warning-card" key={plannerWarningKey(warning)}>
              <strong>{formatPlannerWarningTitle(warning)}</strong>
              <p>{warning.message}</p>
              {formatPlannerWarningPills(warning).length > 0 ? (
                <div className="account-signals">
                  {formatPlannerWarningPills(warning).map((pill) => (
                    <span className="signal-pill" key={`${warning.code}-${pill}`}>
                      {pill}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {refreshMessage ? <p className={refreshMessageAdvisory ? 'warning-text' : 'success-text'}>{refreshMessage}</p> : null}
      {loadError ? <p className="error-text">Broker load error: {loadError}</p> : null}
      {mutationError ? <p className="error-text">Broker mutation error: {mutationError}</p> : null}
    </section>
  );
}
