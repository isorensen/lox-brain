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
3. `npm run build` (compilacao TypeScript)
4. `npm run test:coverage` (vitest com threshold 80%)
5. `npm audit --audit-level=high` (vulnerabilidades em dependencias)

Se qualquer step falhar, o PR nao pode ser mergeado (embora branch protection nao esteja ativo por limitacao do GitHub Free).

## Deploy workflow (deploy.yml)

Roda automaticamente no merge para `main`:
1. Autentica via service account `github-actions-deploy` (chave JSON no GitHub Secrets `GCP_SA_KEY`)
2. Conecta na VM via `gcloud compute ssh` com IAP tunnel (sem expor SSH publicamente)
3. Executa `infra/deploy.sh` na VM via `nohup`, logando em `/tmp/deploy.log`
4. Health check: verifica que `lox-watcher` esta ativo e que `/tmp/deploy.log` termina com `DEPLOY_SUCCESS`

> [!NOTE]
> O deploy e delegado ao script `scripts/deploy.sh` na VM. O workflow GitHub Actions apenas aciona o script via SSH -- nao executa os passos de build/restart diretamente.

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

- faz deploy de: [[Lox - Vault Watcher]], [[Lox - MCP Server]]
- hospedado em: [[Lox - Infraestrutura GCP]]
- valida: [[Lox - Estrategia de Testes]]
- contido em: [[Lox]]

## References

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `docs/plans/2026-03-09-cicd-github-actions-design.md`
- `docs/HANDOFF.md` (notas de sessao CI/CD)
