# CostByFieldPage shows blank screen when no data — add empty state
- Read CostByFieldPage.tsx. Find where it renders the cost table.
- Add an empty state component: icon + "لا توجد تكاليف للحقول في الموسم المحدد" message.
- Also add a season selector dropdown if not already present (using configApi.seasons).
Verification:
- Selecting a season with no costs shows the empty state, not a blank table.
