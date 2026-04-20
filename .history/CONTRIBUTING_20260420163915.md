# Contributing to Agri-Nile Flow

Welcome! 🌾 We're building an integrated agricultural management system together.

---

## 📋 Code of Conduct

- **Respectful**: Treat all team members with respect
- **Collaborative**: Share knowledge and help each other
- **Secure**: Always prioritize security and data protection
- **Quality**: Commit to code quality and testing
- **Transparent**: Communicate openly about progress and blockers

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** 22+
- **Git** 2.0+
- **Cloudflare Account** (for deployment)
- **Code Editor**: VS Code recommended

### Setup Local Environment

```bash
# Clone repository
git clone https://github.com/YOUR_ORG/agri-nile-flow.git
cd agri-nile-flow

# Install dependencies
npm install
cd web && npm install && cd ..

# Create .env file
cp .env.example .env

# Start local development
npm run dev           # Backend: localhost:4173
cd web && npm run dev # Frontend: localhost:5173
```

### Environment Setup

Edit `.env`:
```env
NODE_ENV=development
DEBUG=true
VITE_API_URL=http://localhost:4173/api
```

---

## 📝 Development Workflow

### 1. Create Feature Branch

```bash
# Create branch from latest main
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# Branch naming conventions:
# - feature/add-user-dashboard
# - fix/correct-wac-calculation
# - chore/update-dependencies
# - docs/add-deployment-guide
```

### 2. Make Changes

```bash
# Edit code in your feature branch
# Test locally before committing

npm run dev              # Backend dev
cd web && npm run dev    # Frontend dev

# Run tests (if available)
npm test
```

### 3. Commit with Semantic Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git add .

# Format: type(scope): description
git commit -m "feat(inventory): add WAC calculation for stock movements"

# Types:
# - feat     = new feature
# - fix      = bug fix
# - chore    = routine tasks (deps, config)
# - docs     = documentation
# - refactor = code restructure (no behavior change)
# - test     = tests only
# - perf     = performance improvement
# - ci       = CI/CD changes

# Good examples:
# ✅ feat(auth): implement JWT token refresh
# ✅ fix(treasury): correct running balance calculation
# ✅ chore(deps): update nodejs to 22.0.0
# ✅ docs: add setup guide for new developers
# ❌ Fixed bug
# ❌ Updated code
# ❌ Made changes
```

### 4. Push & Create Pull Request

```bash
# Push to remote
git push origin feature/your-feature-name

# Create PR on GitHub
# Fill in the PR template completely
```

### 5. PR Template Checklist

```markdown
## Description
Brief explanation of what this PR does

## Type of Change
- [ ] Bug fix (fixes existing issue)
- [ ] New feature (adds new capability)
- [ ] Breaking change (API change)
- [ ] Security fix (addresses vulnerability)
- [ ] Documentation update

## Testing
- [ ] Tested locally
- [ ] Added/updated tests
- [ ] No console errors
- [ ] Verified database queries

## Security
- [ ] No secrets in code
- [ ] No hardcoded credentials
- [ ] Input validation on all endpoints
- [ ] Database queries parameterized
- [ ] CORS properly restricted

## Checklist
- [ ] Code follows project standards
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No breaking changes
- [ ] TypeScript compiles without errors
```

### 6. Code Review & Approval

- **Minimum Reviewers**: 2
- **Required Checks**:
  - ✅ Security scanning (secrets, CodeQL)
  - ✅ Build succeeds
  - ✅ npm audit passes
  - ✅ Tests pass (if applicable)

### 7. Merge & Deploy

Once approved:
- Maintainer squashes commits and merges to `main`
- CI/CD automatically deploys to production
- Delete feature branch

---

## 💻 Code Standards

### TypeScript
```typescript
// ✅ Good
async function fetchSuppliers(companyId: string): Promise<Supplier[]> {
  const response = await db.query('SELECT * FROM suppliers WHERE company_id = ?', [companyId]);
  return response;
}

// ❌ Bad
async function fetch(id) {
  return db.query('SELECT * FROM suppliers WHERE company_id = ' + id);
}
```

### React Components
```typescript
// ✅ Good (functional component with hooks)
interface SupplierListProps {
  companyId: string;
  onSelect: (supplier: Supplier) => void;
}

export const SupplierList: React.FC<SupplierListProps> = ({ companyId, onSelect }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSuppliers(companyId).then(setSuppliers);
  }, [companyId]);

  return (
    <div>
      {suppliers.map(s => (
        <button key={s.id} onClick={() => onSelect(s)}>
          {s.name}
        </button>
      ))}
    </div>
  );
};

// ❌ Bad (class component, no TypeScript)
class SupplierList extends React.Component {
  render() {
    return <div>...</div>;
  }
}
```

### Error Handling
```typescript
// ✅ Good
try {
  const response = await api.post('/api/suppliers', supplierData);
  showSuccessToast('Supplier created successfully');
} catch (error) {
  if (error instanceof ValidationError) {
    showErrorToast('Please check your input: ' + error.message);
  } else if (error instanceof UnauthorizedError) {
    redirectToLogin();
  } else {
    showErrorToast('Failed to create supplier');
    console.error(error);
  }
}

// ❌ Bad
try {
  await api.post('/api/suppliers', data);
} catch (e) {
  console.log('Error: ' + e);
}
```

### API Endpoints
```typescript
// ✅ Good
router.post('/suppliers', authenticate, async (c) => {
  const companyId = c.get('company_id'); // From JWT
  const body = await c.req.json();

  if (!body.name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const supplier = await db.insert('suppliers', {
    ...body,
    company_id: companyId,
    created_at: new Date(),
  });

  return c.json(supplier, 201);
});

// ❌ Bad
router.post('/suppliers', async (c) => {
  const body = await c.req.json();
  const result = await db.insert('suppliers', body);
  return c.json(result);
});
```

---

## 🔐 Security Checklist

Before committing, verify:

- [ ] **No secrets**: No `.env`, API keys, passwords
- [ ] **No logs**: Remove `console.log()` with sensitive data
- [ ] **Input validation**: All user inputs validated
- [ ] **SQL queries**: All parameterized (no string concatenation)
- [ ] **Authentication**: Routes protected where needed
- [ ] **CORS**: Properly restricted to safe origins
- [ ] **Errors**: Generic error messages (no stack traces)
- [ ] **Dependencies**: No suspicious packages (`npm audit`)

---

## 📚 Architecture Guide

### Backend (Hono on Cloudflare Workers)
```
src/
├── index.ts           # App entry, CORS, routes
├── types.ts           # TypeScript interfaces
├── middleware/
│   └── auth.ts        # JWT validation
└── api/
    ├── auth.ts        # /api/auth/*
    ├── suppliers.ts   # /api/suppliers/*
    ├── treasury.ts    # /api/treasury/*
    ├── inventory.ts   # /api/inventory/*
    ├── dashboard.ts   # /api/dashboard/*
    ├── config.ts      # /api/config/*
    └── users.ts       # /api/users/*
```

### Frontend (React + Vite)
```
web/src/
├── api/
│   └── client.ts      # API wrapper
├── store/
│   └── appStore.ts    # Global state
├── components/
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── forms/
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── suppliers/
│   ├── treasury/
│   ├── inventory/
│   ├── config/
│   └── users/
├── types/
│   └── index.ts       # TypeScript types
├── App.tsx
└── main.tsx
```

### Database (D1 SQLite)
```
schema.sql            # 35 tables
├── Users/Auth
├── Suppliers
├── Treasury
├── Inventory
└── Configuration
```

---

## 🧪 Testing

### Local Testing

```bash
# Test backend locally
npm run dev

# Test in PowerShell
$response = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -Method GET
# Output: @{"status"="ok"}

# Test frontend
cd web && npm run dev
# Open http://localhost:5173
```

### Database Testing

```bash
# Query database
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command "SELECT COUNT(*) FROM suppliers;"

# Insert test data
npx wrangler d1 execute agri-nile-flow-data-lake --remote --command "INSERT INTO suppliers (name, code, company_id) VALUES ('Test Supplier', 'TS001', 1);"
```

---

## 🐛 Bug Reports

Found a bug? Report it!

1. Go to **Issues** → **New Issue**
2. Use template: **Bug Report**
3. Include:
   - Clear title
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Screenshots/logs
   - Environment info

---

## 📖 Documentation

### Update Docs When:
- [ ] Adding new API endpoint
- [ ] Changing database schema
- [ ] Adding new feature
- [ ] Fixing security issue

### Documentation Files:
- `README.md` — Project overview
- `DEVELOPMENT_PLAN.md` — Development guide
- `SECURITY.md` — Security policies
- `DEPLOYMENT_STATUS.md` — Production details
- `CHANGELOG.md` — Version history

---

## 📤 Deployment

### Automatic (via GitHub Actions)
```
1. Create PR on GitHub
2. Get 2 approvals
3. Merge to main
4. CI/CD automatically deploys to production
```

### Manual (Local)
```bash
# Backend
npx wrangler deploy

# Frontend
cd web && npm run build
npx wrangler pages deploy dist --project-name agri-nile-flow-lake
```

---

## ❓ FAQ

### Q: How do I set up local development?
A: See "Getting Started" section above. Run `npm install && npm run dev`.

### Q: My build is failing. What do I do?
A: 
1. Clear cache: `rm -rf node_modules && npm install`
2. Check TypeScript: `tsc --noEmit`
3. Check git status: `git status`

### Q: How do I commit without deploying?
A: All commits to `main` auto-deploy via CI/CD. Use feature branches for local commits.

### Q: Can I force push?
A: ❌ No. If you need to undo, open a revert PR instead.

### Q: Where's the admin password?
A: See `.env.example` or DEVELOPMENT_PLAN.md. Never share via chat — use secure vault.

---

## 📞 Support

### Resources
- 📚 [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) — Dev guide
- 🔐 [SECURITY.md](./SECURITY.md) — Security policies
- 🚀 [DEPLOYMENT_STATUS.md](./DEPLOYMENT_STATUS.md) — Production info
- 🐙 [GITHUB_SETUP.md](./GITHUB_SETUP.md) — GitHub config

### Contact
- **Lead Developer**: mahmoud.zahran@agri-nile.eg
- **Team**: agri-nile-flow@company.eg

---

## 🎉 Thank You!

Your contributions make Agri-Nile Flow better every day. Let's build something amazing together! 🚀

**Happy coding!** 💚
