2026-03-14 11:10

Status: #baby

Tags: [[claude-skill]] [[lox]] [[cicd]] [[infraestrutura]]
source: claude-skill

# CI/CD com GitHub Actions no Lox

O projeto usa dois workflows GitHub Actions para validacao automatica e deploy continuo.

## CI workflow (ci.yml)

Roda em todo PR para `main`:
1. `npm ci` (instalacao limpa)
2. `tsc --noEmit` (type check)
3. `npm run test:coverage` (vitest com threshold 80%)
4. `npm audit` (vulnerabilidades em dependencias)

Se qualquer step falhar, o PR nao pode ser mergeado (embora branch protection nao esteja ativo por limitacao do GitHub Free).

## Deploy workflow (deploy.yml)

Roda automaticamente no merge para `main`:
1. Autentica via service account `github-actions-deploy` (chave JSON no GitHub Secrets)
2. Conecta na VM via `gcloud compute ssh` com IAP tunnel (sem expor SSH publicamente)
3. `git pull origin main` no diretorio do projeto na VM
4. `npm ci --omit=dev` (apenas dependencias de producao)
5. `npm run build` (TypeScript -> JavaScript)
6. `systemctl restart lox-watcher` (reinicia [[vault-watcher]])
7. `pkill -f "packages/core"` (mata MCP sessions antigas)
8. Health check: verifica que watcher esta ativo apos deploy

## Service account para deploy

`github-actions-deploy` com roles de least privilege:
- `iap.tunnelResourceAccessor` (SSH via IAP)
- `compute.instanceAdmin.v1` (gerenciar VM)
- `iam.serviceAccountUser` (impersonate)
- `compute.osLogin` (login na VM)

Chave rotacionada a cada 90 dias (proximo: 2026-06-08). Meta de longo prazo: migrar para Workload Identity Federation (keyless).

## Limitacoes conhecidas

- Branch protection requer GitHub Pro -- CI roda mas merge nao e bloqueado automaticamente
- `google-github-actions/auth@v2` usa Node.js 20 deprecated (deadline: junho 2026 para migrar)

## Relacoes

- faz deploy de: [[vault-watcher]], [[mcp-server]]
- hospedado em: [[infraestrutura-gcp]]
- valida: [[estrategia-testes]]
- contido em: [[_MOC]]

## References

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `docs/plans/2026-03-09-cicd-github-actions-design.md`
- `docs/HANDOFF.md` (notas de sessao CI/CD)
