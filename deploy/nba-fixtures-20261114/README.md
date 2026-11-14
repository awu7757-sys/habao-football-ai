# NBA fixture credential fix and provider block — 2026-11-14

basketball-fixtures v44 now prefers API_NBA_KEY, falling back to API_FOOTBALL_KEY only if absent. World Cup retains its existing credential. Five credential-routing tests passed. Existing source v43 used only API_FOOTBALL_KEY.

Live verification is NOT passed: both Nov 14 and Nov 15 still return 502. Provider games endpoint returned HTTP 200 with errors.plan: Free plans do not have access to this season, try from 2022 to 2024.

An authenticated diagnostic (request 83208) confirmed both environment keys are configured and identical. The NBA status endpoint returned errors.requests: daily request limit reached, for both labels. No key values or provider account identities were returned. This does not establish a paid-plan expiry date or the exact account quota.

The temporary diagnostic action was removed by restoring the original sports-release-verify code (v5). No member credits, predictions, saved snapshots, subscriptions or API keys were changed. Provider subscription/key access must be resolved before the live fixture list can be verified successfully. Do not substitute historical seasons or fabricate empty schedules as success.
