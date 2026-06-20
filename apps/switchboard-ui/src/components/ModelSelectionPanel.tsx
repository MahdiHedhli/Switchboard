/* "Model selection" panel: selector warnings (unresolved / placeholder-skipped)
 * and the read-only model catalog (active + placeholder rows). */
import type { ProjectDashboardSnapshot } from '@switchboard/core';

type ModelSelectionPanelProps = {
  isLoading: boolean;
  selectionWarnings: NonNullable<ProjectDashboardSnapshot['selectionWarnings']>;
  modelCatalog: NonNullable<ProjectDashboardSnapshot['catalog']>;
};

export function ModelSelectionPanel({
  isLoading,
  selectionWarnings,
  modelCatalog,
}: ModelSelectionPanelProps) {
  return (
    <section className="panel">
      <h2>Model selection</h2>
      <div className="stack">
        {!isLoading && selectionWarnings.length === 0 ? (
          <p className="muted">No selection warnings — declared task-classes resolved cleanly.</p>
        ) : null}
        {selectionWarnings.map((warning) => (
          <article className="card warning-card" key={`${warning.code}-${warning.taskId}`}>
            <strong>
              {warning.code === 'selection_unresolved' ? 'Unresolved selection' : 'Placeholder skipped'}
            </strong>
            <p>{warning.message}</p>
            <div className="account-signals">
              <span className="signal-pill">task: {warning.taskId}</span>
              {warning.taskClass ? <span className="signal-pill">class: {warning.taskClass}</span> : null}
              {warning.excluded?.map((row) => (
                <span className="signal-pill" key={`${warning.taskId}-${row.provider}-${row.modelId}`}>
                  excluded: {row.provider}/{row.modelId}
                </span>
              ))}
            </div>
          </article>
        ))}
        <div className="catalog-panel">
          <h3>Model catalog</h3>
          {!isLoading && modelCatalog.active.length === 0 && modelCatalog.placeholders.length === 0 ? (
            <p className="muted">No catalog rows are configured for this broker.</p>
          ) : null}
          {modelCatalog.active.map((row) => (
            <div className="catalog-row" key={`active-${row.provider}-${row.modelId}`}>
              <span className="catalog-model">{row.provider}/{row.modelId}</span>
              <div className="account-signals catalog-tags">
                <span className="signal-pill">tier: {row.tier}</span>
                <span className="signal-pill catalog-active">active</span>
              </div>
            </div>
          ))}
          {modelCatalog.placeholders.map((row) => (
            <div className="catalog-row" key={`placeholder-${row.provider}-${row.modelId}`}>
              <span className="catalog-model">{row.provider}/{row.modelId}</span>
              <div className="account-signals catalog-tags">
                <span className="signal-pill">tier: —</span>
                <span className="signal-pill catalog-placeholder">placeholder</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
