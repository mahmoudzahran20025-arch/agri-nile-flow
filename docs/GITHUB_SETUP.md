# 🔐 GitHub Repository Setup — Security Checklist

## Status: CONFIGURATION REQUIRED ⚠️

Follow these steps to properly secure the GitHub repository.

---

## Part 1: Repository Settings

### 1.1 Basic Settings
- [ ] Repository name: `agri-nile-flow`
- [ ] Description: "Integrated agricultural management system (ERP)"
- [ ] Visibility: **Private** (company data)
- [ ] Default branch: `main`

### 1.2 Access Control
```
Repository Settings → Access → Collaborators and teams
```
- [ ] Add team members with appropriate roles:
  - **Maintainers**: Full access, can approve/merge PRs
  - **Developers**: Push to feature branches, create PRs
  - **Viewers**: Read-only access for monitoring

---

## Part 2: Branch Protection

### 2.1 Protect Main Branch
```
Settings → Branches → Branch protection rules → Add rule
```

**Branch name pattern**: `main`

- [x] **Require pull request reviews before merging**
  - Minimum reviewers: **2**
  - Dismiss stale pull request approvals: **YES**
  - Require review from code owners: **YES**

- [x] **Require status checks to pass**
  - Required status checks:
    - `security-checks` (secrets scan, CodeQL, npm audit)
    - `build-test` (compilation verification)
  - Require branches to be up to date: **YES**

- [x] **Require code scanning analysis to pass**
  - CodeQL: **ENABLED**

- [x] **Restrict who can push**
  - Only allow maintainers to push: **YES**

- [x] **Allow auto merge**: **YES** (with squash or merge commits)

- [x] **Delete head branches**: **YES**

---

## Part 3: GitHub Secrets & Environments

### 3.1 Create Environments
```
Settings → Environments
```

#### `production` Environment
- **Branches**: Only `main` can deploy
- **Required reviewers**: 1 maintainer
- **Deployment branches**: `main` only

#### `staging` Environment  
- **Branches**: `develop` and `main`
- **Required reviewers**: 0 (optional)

### 3.2 Add Secrets (if using CI/CD)

```
Settings → Secrets and variables → Actions → New repository secret
```

**Required Secrets** (if deploying via GitHub Actions):

| Secret Name | Value | When Needed |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Your Cloudflare API token | For automated deployment |
| `CLOUDFLARE_ACCOUNT_ID` | `8101db8ecafb1db6e0e0581acc665778` | For automated deployment |
| `CLOUDFLARE_D1_BINDING` | `agri-nile-flow-data-lake` | For automated deployment |

**DO NOT ADD**:
- ❌ JWT_SECRET (store in Cloudflare Worker Secrets only)
- ❌ Database passwords (handled by Cloudflare D1 auth)
- ❌ Any `.env` values

### 3.3 Protect Secrets
```
Settings → Secrets and variables → Actions
```
- [x] Enable "Require GitHub Actions approval on fork pull requests"
- [x] All secrets read-only by default

---

## Part 4: Code Scanning & Security

### 4.1 Enable GitHub Advanced Security
```
Settings → Code security and analysis
```

- [x] **Dependabot alerts**: **ENABLED**
- [x] **Dependabot security updates**: **ENABLED** 
  - Create PR for all patches automatically

- [x] **Secret scanning**: **ENABLED**
  - Notify on public push: **YES**

- [x] **CodeQL analysis**: **ENABLED**
  - Use workflow: `.github/workflows/security.yml`

### 4.2 Configure Security Alerts
```
Settings → Code security and analysis → Code scanning alerts
```
- [x] Dismiss alerts: Can only be dismissed by maintainers
- [x] Auto-dismiss: No automatic dismissal
- [x] On public push: Alert immediately

---

## Part 5: Actions Permissions

### 5.1 Workflow Permissions
```
Settings → Actions → General → Workflow permissions
```

- [x] Read and write permissions: **ENABLED** (for auto-merge)
- [x] Allow GitHub Actions to create and approve pull requests: **YES**

### 5.2 Allowed Actions
- [x] Allow actions created by GitHub
- [x] Allow Marketplace actions by verified creators
- [x] Require approval for all outside Marketplace actions

---

## Part 6: Code Owners & Governance

### 6.1 Create CODEOWNERS File
Create `.github/CODEOWNERS`:

```
# Global default
* @mahmoud-zahran

# Security-sensitive areas
SECURITY.md @mahmoud-zahran
.github/workflows/ @mahmoud-zahran
src/middleware/auth.ts @mahmoud-zahran
wrangler.toml @mahmoud-zahran

# Database schema
schema.sql @mahmoud-zahran
schema_phase*.sql @mahmoud-zahran
```

### 6.2 Require CODEOWNERS Review
Done via branch protection (Part 2.1)

---

## Part 7: Pull Request Settings

### 7.1 PR Templates
Create `.github/pull_request_template.md`:

```markdown
## Description
_Brief description of changes_

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Security fix
- [ ] Documentation update

## Checklist
- [ ] Code follows project standards
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No secrets committed
- [ ] Security review (if needed)

## Security Implications
_Any security changes or concerns?_
```

### 7.2 PR Policies
```
Settings → Pull requests
```
- [x] Allow auto-merge: **YES**
- [x] Default merge method: **Squash and merge**
- [x] Delete head branches: **YES**
- [x] Always suggest updating pull request branches: **YES**

---

## Part 8: Audit & Logging

### 8.1 Enable Audit Log
```
Settings → Audit log
```
- [ ] Review weekly for unauthorized access
- [ ] Archive logs periodically

### 8.2 Member Audit
```
Manage access → Members
```
- [ ] Quarterly review of team members
- [ ] Remove inactive members
- [ ] Verify MFA enabled on all accounts

---

## Part 9: Webhook & Integration Security

### 9.1 Webhooks
```
Settings → Webhooks
```
- ✅ **DO**: Only use GitHub Actions (official)
- ❌ **DON'T**: Add external webhooks without security review

### 9.2 Branch Auto-link References
- [ ] Enable auto-link (optional)

### 9.3 Deploy Keys
```
Settings → Deploy keys
```
- ✅ For Cloudflare: Use API token instead
- ❌ Never add repo deploy keys with write access

---

## Part 10: Issue & Discussion Settings

### 10.1 Issues
```
Settings → Features
```
- [x] Issues: **ENABLED** (for bug tracking)
- [x] Issue templates: Add security issue template

### 10.2 Issue Template for Security
Create `.github/ISSUE_TEMPLATE/security.md`:

```markdown
---
name: 🔐 Security Issue
about: Report a security vulnerability (confidential)
---

## Severity
- [ ] Critical (immediate action needed)
- [ ] High (urgent)
- [ ] Medium (soon)
- [ ] Low (monitor)

## Description
_Describe the vulnerability_

**Do NOT include**: Exploitation code, proof of concept, credentials

## Suggested Fix
_How should this be fixed?_

**Note**: Security issues are kept private until resolved.
```

---

## Part 11: Archival & Disaster Recovery

### 11.1 Regular Backups
- [ ] Weekly export of code (automated)
- [ ] Monthly export of issues & PRs
- [ ] Store backups in 2 locations

### 11.2 Disaster Recovery Plan
- [ ] If repo is deleted: Restore from backup within 24 hours
- [ ] If compromised: Contact GitHub support immediately
- [ ] If credentials leaked: Rotate all secrets immediately

---

## Part 12: Documentation & Governance

### 12.1 Create README.md
Done ✅ (see root README.md)

### 12.2 Create Contributing Guide
Create `CONTRIBUTING.md`:

```markdown
# Contributing to Agri-Nile Flow

## Development Workflow

1. Create feature branch: `git checkout -b feature/your-feature`
2. Commit with semantic messages (feat, fix, chore, etc.)
3. Push and create PR
4. Wait for 2 approvals + CI/CD pass
5. Maintainer merges and deploys

## Code Standards
- Use TypeScript for all backend code
- Components must be functional + hooks
- All APIs must have error handling
- Document public functions

## Security Checklist
- [ ] No hardcoded secrets
- [ ] No `console.log()` with sensitive data
- [ ] All user input validated
- [ ] Database queries parameterized
- [ ] No breaking changes to API
```

### 12.3 Create LICENSE
Create `LICENSE` (MIT or your company license):

```
MIT License

Copyright (c) 2026 Agri-Nile Flow Team

Permission is hereby granted...
```

---

## Part 13: Team Communication

### 13.1 GitHub Discussion
```
Settings → Features → Discussions
```
- [x] Enable discussions for announcements
- [x] Categories: Announcements, Q&A, Ideas

### 13.2 GitHub Project Board
```
Projects → New project
```
Create "Development Roadmap" board with columns:
- Backlog
- In Progress
- Review
- Done

---

## Part 14: Deployment Safeguards

### 14.1 Release Management
```
Releases → Create release
```
- [ ] Tag format: `v1.0.0` (semantic versioning)
- [ ] Release notes: What's new, fixed, security patches
- [ ] GitHub Actions auto-deploys on tag

### 14.2 Hotfix Process
```
For urgent security fixes:
1. Branch from main: git checkout -b hotfix/security-fix
2. Make fix
3. Create PR with label "security"
4. Require only 1 approval (emergency)
5. Tag as v1.0.1 immediately
6. Deploy to production
```

---

## Part 15: Monitoring & Alerts

### 15.1 GitHub Notifications
- [x] Watch repository
- [x] Enable notifications for security alerts
- [x] Set notification frequency: Instant for security

### 15.2 CI/CD Monitoring
- [ ] Monitor build status daily
- [ ] Alert on failed deployments
- [ ] Track deployment times

---

## Implementation Checklist

### ✅ IMMEDIATE (Do Now)
- [ ] Part 1: Basic Settings
- [ ] Part 2: Branch Protection (main only)
- [ ] Part 3: Secrets (production environment)
- [ ] Part 4: Security scanning
- [ ] Part 5: Actions permissions

### ⏳ SOON (This Week)
- [ ] Part 6: Code owners
- [ ] Part 7: PR templates
- [ ] Part 8: Audit log
- [ ] Part 9: Webhooks review
- [ ] Part 10: Issue templates

### 📋 ONGOING (Monthly)
- [ ] Part 11: Backups & recovery
- [ ] Part 12: Documentation updates
- [ ] Part 13: Team communication
- [ ] Part 14: Release management
- [ ] Part 15: Monitoring

---

## Reference URLs

- GitHub Docs: https://docs.github.com/
- Security Best Practices: https://docs.github.com/en/code-security
- Branch Protection: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches
- Secrets Management: https://docs.github.com/en/actions/security-guides/encrypted-secrets

---

## Support

For questions about GitHub configuration, see:
- `.github/workflows/security.yml` — Security automation
- `SECURITY.md` — Security policies
- `DEVELOPMENT_PLAN.md` — Development guide

---

**Last Updated**: April 20, 2026  
**Status**: READY FOR IMPLEMENTATION ✅  
**Next Review**: May 20, 2026

For urgency or concerns, contact the team immediately.
