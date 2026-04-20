# 🔐 Agri-Nile Flow — Security Policy & Guidelines

## Confidentiality Level: **INTERNAL**

---

## 1. Secrets Management

### Never Commit
```
❌ .env (use .env.example instead)
❌ JWT_SECRET (stored in Cloudflare Worker Secrets)
❌ Database credentials
❌ API keys
❌ Private keys
❌ Excel files with real company data
```

### How to Set Secrets
```bash
# JWT Secret (required)
printf "your_random_secret" | npx wrangler secret put JWT_SECRET

# Verify
npx wrangler secret list
```

### Secret Generation (Recommended)
```bash
# Generate a cryptographically secure secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Code Security Best Practices

### Authentication
- ✅ All routes require JWT (except `/api/auth/login`)
- ✅ JWT extracted and validated before request execution
- ✅ company_id ALWAYS from JWT token, never from request body
- ✅ PBKDF2-SHA256 with 100,000 iterations for password hashing

### Database
- ✅ All queries filtered by `company_id` (multi-tenant isolation)
- ✅ SQL injection protected (parameterized queries)
- ✅ No credentials in code
- ✅ Sensitive data encrypted in database

### Data Access
- ✅ Role-based access control (6 roles: super_admin, accountant, etc.)
- ✅ Field-level permissions in future
- ✅ Audit log for all critical operations
- ✅ User sessions with expiration

---

## 3. Files & Directories to Ignore

### ✅ .gitignore Includes
```
.env*                          # Never commit environments
*.xlsx                         # Real company data
node_modules/                  # Dependencies
dist/, build/                  # Build artifacts
.wrangler/                     # Cloudflare dev artifacts
.vscode/, .idea/              # IDE configs
wrangler.secret               # Cloudflare secrets
*.log                         # Logs
*.db, *.sqlite               # Local databases
```

---

## 4. Sensitive Data Handling

### Excel/CSV Files
- 📊 **Do NOT commit** `.xlsx` or `.csv` files with real data
- 📊 Stored in `/migrate/` but **ignored by .gitignore**
- 📊 Use only for local import (`node migrate/import.js`)

### Database Backups
- 💾 **Do NOT commit** `.db` or `.backup` files
- 💾 Use Cloudflare D1 backup/restore (manual via UI)
- 💾 Or via: `npx wrangler d1 backup restore`

### Environment Variables
- 🔑 All `.env*` files ignored
- 🔑 `.env.example` safe to commit (template only)
- 🔑 Each developer creates `.env` locally

---

## 5. GitHub Repository Configuration

### Recommended Settings

#### Branch Protection (main/production)
```
✅ Require pull request reviews (minimum 1)
✅ Dismiss stale pull request approvals
✅ Require status checks to pass
✅ Restrict who can push to matching branches
✅ Require branches to be up to date before merging
```

#### Secrets Management
```
Use GitHub Secrets for CI/CD:
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID
- JWT_SECRET (if needed for CI)
```

#### Code Scanning
```
✅ Enable GitHub Advanced Security
✅ Enable Dependabot alerts
✅ Enable CodeQL analysis
```

---

## 6. Commit Strategy (6 Commits)

### Commit 1: Infrastructure & Schema
```
feat: initialize schema and database structure

- Create 35 tables with proper indexes
- Add seed data (roles, permissions)
- Set up D1 binding in wrangler.toml
- Add security best practices docs
```

### Commit 2: Data Mapping Fixes
```
fix: correct inventory data column mappings

- Add package_type, pack_capacity, pack_count fields
- Map column [24] as unit_price (not category)
- Fix startRow for all import configs
- Update config.js with complete mappings
```

### Commit 3: Backend Deployment
```
feat: deploy backend to Cloudflare Workers

- Fix duplicate variable in treasury.ts
- Deploy to https://agri-nile-flow.mahm-zahran22.workers.dev
- Verify all API endpoints working
- Add health check endpoint
```

### Commit 4: Frontend Deployment
```
feat: deploy frontend to Cloudflare Pages

- Build and deploy to https://fb7b4223.agri-nile-flow-lake.pages.dev
- Configure CORS for backend integration
- Add .env.example for local development
```

### Commit 5: Data Import Completion
```
feat: import 1,065 real company records

- 10 suppliers with 286 transactions
- 69 cash transactions (balance: -19,801 EGP)
- 700 inventory movements (WAC calculated)
- All data verified and balanced
```

### Commit 6: Security & Documentation
```
chore: add security config and deployment docs

- Create .gitignore with sensitive file exclusions
- Add .env.example template
- Create SECURITY.md policy
- Add DEPLOYMENT_STATUS.md report
- Update DEVELOPMENT_PLAN.md with all URLs
- Configure GitHub security settings
```

---

## 7. OAuth & Third-Party Integrations

### Currently Disabled ✅
- ❌ No OAuth (login is email/password only)
- ❌ No API keys for external services
- ❌ No webhooks configured

### Future Consideration
- If integrating payment gateways: store tokens in Cloudflare KV
- If using SMS: API keys in Worker Secrets, never in code
- If using email: credentials in Cloudflare Environment

---

## 8. Dependency Security

### Regular Audits
```bash
# Check for vulnerabilities
npm audit
npm audit fix

# Update dependencies safely
npm update

# Check outdated packages
npm outdated
```

### Never Install Unknown Packages
- ✅ Only install from official npm registry
- ✅ Verify package authenticity before install
- ✅ Check for typosquatting (e.g., `expres` vs `express`)

---

## 9. Access Control

### Who Has Access
- 👤 **Development Team**: Full access to main branch
- 🔐 **Secrets**: Only via Cloudflare dashboard
- 📊 **Database**: Only via authenticated API
- 🔑 **Admin Account**: Generated once, shared securely

### MFA Requirement
- ✅ Enable MFA on all GitHub accounts
- ✅ Enable MFA on Cloudflare account
- ✅ Store backup codes securely

---

## 10. Incident Response

### If Secret is Leaked
1. ⚠️ Immediately notify team
2. 🔑 Rotate the secret
3. 📋 Review access logs (wrangler tail)
4. 🛡️ Re-deploy affected services
5. 📝 Document incident

### If Commit Contains Sensitive Data
```bash
# Remove from history (use BFG Repo-Cleaner or git-filter)
# Do NOT just delete in next commit (still in history!)

# Example with BFG:
bfg --delete-files *.xlsx --no-blob-protection

# Force push (after team notification)
git push --force-with-lease origin main
```

---

## 11. Audit & Compliance

### Logs to Review
```bash
# Backend request logs
npx wrangler tail

# Git commit history
git log --oneline --all --decorate

# Database audit log
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100;
```

### Regular Checks
- [ ] Weekly: Review .gitignore compliance
- [ ] Monthly: Audit GitHub access
- [ ] Monthly: Review database audit_log
- [ ] Quarterly: Security dependency scan
- [ ] Annually: Penetration testing

---

## 12. Data Classification

| Classification | Examples | Handling |
|---|---|---|
| **Public** | API docs, schema | Safe to commit |
| **Internal** | Source code, deployment URLs | In repo, not secrets |
| **Confidential** | .env, JWT_SECRET, Excel data | Never commit |
| **Restricted** | Database backups, logs | Encrypted, access controlled |

---

## 13. Acceptable Use Policy

### Do ✅
- Commit: Source code, configuration templates, documentation
- Use secrets manager: Cloudflare Secrets, GitHub Secrets
- Review: All pull requests before merge
- Encrypt: Sensitive data in transit (HTTPS only)

### Don't ❌
- Commit: .env files, Excel data, private keys, passwords
- Hardcode: Secrets, credentials, API keys
- Share: Admin passwords in chat (use shared vault)
- Reuse: Secrets across environments (dev/staging/prod)

---

**Last Updated:** April 20, 2026  
**Status:** ✅ ACTIVE  
**Next Review:** May 20, 2026

For questions or concerns, contact the security team.
