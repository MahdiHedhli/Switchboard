# Quota Snapshot Schema

## Purpose

Sanitized quota snapshots let Switchboard refresh subscription state without persisting raw provider credentials, cookies, or full usage exports.

The same schema is also used by trusted provider sync commands that emit sanitized JSON to stdout.

## Location

Place private local snapshot files under:

` .switchboard/provider-snapshots/ `

Examples:
- `.switchboard/provider-snapshots/openai.json`
- `.switchboard/provider-snapshots/anthropic.json`
- `.switchboard/provider-snapshots/google.json`

These files should stay ignored by git and should use restrictive local permissions.

Trusted command output should not be written to git-backed paths unless an operator intentionally saves a sanitized copy for local debugging.

## Schema

```json
{
  "provider": "openai",
  "accounts": [
    {
      "id": "openai-main",
      "displayName": "OpenAI Subscription",
      "authMode": "subscription",
      "owner": "operator",
      "lastRefreshedAt": "2026-04-21T18:15:00.000Z",
      "signals": [
        {
          "id": "plan",
          "label": "plan",
          "value": "Pro"
        }
      ],
      "quotas": [
        {
          "modelId": "codex",
          "displayName": "Codex",
          "availability": "available",
          "authMode": "subscription",
          "usageUnit": "credits",
          "interpretation": "absolute",
          "source": "provider-ui",
          "confidence": "high",
          "remaining": 88,
          "notes": "Sanitized OpenAI usage snapshot."
        }
      ]
    }
  ]
}
```

## Rules

- Include only quota/account metadata needed by the broker.
- Do not include OAuth tokens, cookies, API keys, CLI credential caches, or raw provider exports.
- Keep the top-level `provider` aligned with the filename and adapter being refreshed.
- Snapshot files must not be group-writable or world-writable.
- Trusted command output must use this same schema and must be safe to persist directly as sanitized broker state.
- Use `signals` for account-level plan, credit, or other operator metadata that should not be buried in freeform notes.
- Set `interpretation` to `absolute`, `percentage_window`, or `informational` so the planner can distinguish spendable budgets from advisory windows or descriptive snapshots.
- If a provider exposes multiple rate-limit windows only as percentages, it is acceptable to normalize them into `limit=100`, `used=<percent>`, and `remaining=<percent>` with `interpretation: "percentage_window"` and an optional `windows` array that preserves labeled windows such as `5-hour window` and `Weekly window`.
- Switchboard planning only compares reservations against absolute quota snapshots with matching usage units. Percentage windows and informational snapshots remain visible to operators but should surface as warnings instead of spendable credit assumptions.
