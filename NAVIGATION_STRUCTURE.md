# Recommended GL Navigation Structure

Date: 2026-04-27
Principle: FinanceCore-first workflows, legacy paths visible but clearly demoted

## Sidebar Structure
المالية (GL)
- دفتر الأستاذ
- شجرة الحسابات
- قيود اليومية
- القوائم المالية
- إعدادات GL
  - حوكمة الربط
  - الفترات المالية
  - مجموعات الترحيل
  - إعداد الترحيل
  - لوحة الصحة
  - معالج الإعداد
- أدوات قديمة (Legacy)
  - الربط الثابت (Read-Only)
  - المصنف الذكي (Historical cleanup)

## Route Mapping (Current + Recommended)
- /gl/accounts
- /gl/ledger/:code
- /gl/entries
- /gl/statements
- /gl/settings?tab=integrations (default)
- /gl/posting-groups
- /gl/posting-setup
- /gl/posting-setup/health
- /gl/setup-wizard
- Legacy:
  - /gl/mappings
  - /gl/classifier

## Sunset Guidance
- Keep legacy routes until sunset milestone for compatibility.
- Block writes and surface migration links in UI.
- Remove legacy tabs and routes after final migration signoff.
