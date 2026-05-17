# 668 movements posted but only 10 business_events from inventory module
- Run: SELECT source_module, count(*) FROM business_events GROUP BY source_module.
- Confirm whether inventory movements are expected to generate business_events or use outbox-only path.
- If business_events log is bypassed for inventory: document this as intentional in a comment in postFromBusinessEvent().
Verification:
- Either business_events count matches posted movements, or code has a clear comment explaining why not.
