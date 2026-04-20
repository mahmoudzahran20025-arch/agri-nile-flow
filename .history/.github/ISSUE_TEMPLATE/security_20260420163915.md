---
name: 🔐 Security Vulnerability
about: Report a security vulnerability (CONFIDENTIAL)
title: "🔐 Security: "
labels: security,urgent
---

⚠️ **CONFIDENTIAL** — This issue is not publicly visible

## Severity Level

- [ ] 🔴 **CRITICAL** — Immediate action needed (e.g., data breach, authentication bypass)
- [ ] 🟠 **HIGH** — Urgent fix required (e.g., privilege escalation, SQL injection)
- [ ] 🟡 **MEDIUM** — Soon (e.g., weak encryption, input validation missing)
- [ ] 🟢 **LOW** — Monitor (e.g., dependency outdated, potential future issue)

## Vulnerability Description

Describe the security issue concisely:

### Type
- [ ] Authentication/Authorization
- [ ] SQL Injection / Database
- [ ] XSS (Cross-Site Scripting)
- [ ] CSRF (Cross-Site Request Forgery)
- [ ] Data Exposure
- [ ] Cryptography
- [ ] Dependency/Third-party
- [ ] Other: ___________

## Affected Component

- [ ] Backend (`src/`)
- [ ] Frontend (`web/src/`)
- [ ] Database (`schema.sql`)
- [ ] Infrastructure (Cloudflare)
- [ ] Dependencies (`package.json`)
- [ ] Other: ___________

## Location

Specify where the vulnerability is:
- File: `src/api/auth.ts`
- Line: 42-50
- Function: `verifyPassword()`

## Vulnerability Details

**What is vulnerable?**

Explain the security flaw in technical terms.

**Impact?**

What can an attacker do?
- [ ] Read data
- [ ] Modify data
- [ ] Delete data
- [ ] Execute code
- [ ] Gain access
- [ ] Other: ___________

**Prerequisites?**

What's needed to exploit this?
- [ ] Requires authentication
- [ ] Requires special role
- [ ] Public/unauthenticated
- [ ] Other: ___________

## Proof of Concept (Optional)

**⚠️ DO NOT INCLUDE:**
- ❌ Actual exploitation code
- ❌ Working exploit demonstrations
- ❌ Credentials or sensitive data
- ❌ Screenshots of compromised data

You can describe the attack path in general terms:
"An attacker could exploit this by sending a specially crafted request to `/api/suppliers` with... [generic description]"

## Suggested Fix

How should this be fixed?

```typescript
// Before (vulnerable)
SELECT * FROM suppliers WHERE id = ${id};

// After (secure)
SELECT * FROM suppliers WHERE id = ? AND company_id = ?;
// parameterized with: [id, company_id]
```

## Remediation Priority

- [ ] Immediate (hotfix today)
- [ ] Urgent (this sprint)
- [ ] High (next sprint)
- [ ] Normal (backlog)

## Testing

How can we verify the fix works?

- Test case: `should reject SQL injection in supplier id`
- Expected result: 400 Bad Request

## Disclosure Timeline

- **Reported**: [auto-filled]
- **Acknowledged**: [to be filled]
- **Patch Released**: [to be filled]
- **Public Disclosure**: [to be filled]

(We typically allow 90 days before public disclosure)

## Contact Information

- **Reporter Name**: ___________
- **Contact Email**: ___________
- **Organization**: ___________
- **Preferred Contact**: Email / GitHub / Encrypted Channel

---

## ⚠️ Important Security Guidelines

1. **DO NOT**:
   - ❌ Publicly disclose before patch released
   - ❌ Include working exploits
   - ❌ Share credentials
   - ❌ Test on production

2. **DO**:
   - ✅ Report privately (this issue is private)
   - ✅ Describe the vulnerability clearly
   - ✅ Allow time for patch before disclosure
   - ✅ Test on staging if possible

3. **Privacy**:
   - This issue is only visible to maintainers
   - Sensitive details will not be published
   - Reporter name can be kept confidential

---

## Response Timeline

We aim to:
- ⏱️ **Acknowledge** within 24 hours
- 🔧 **Investigate** within 48 hours
- 🚀 **Patch** within 7 days (unless complex)
- 📢 **Disclose** after 90 days (or on your agreement)

---

**Thank you for helping us keep Agri-Nile Flow secure!** 🙏

For more information, see [SECURITY.md](../../SECURITY.md)
