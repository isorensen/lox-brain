2026-03-14 11:06

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[seguranca]] [[vpn]]
source: claude-skill

# Modelo Zero Trust do Open Brain

O Open Brain adota postura Zero Trust em todas as camadas: nenhum componente e confiavel por padrao, todo acesso e autenticado e autorizado, e a superficie de ataque e minimizada ao extremo.

## Principios aplicados

### Sem IP publico

A VM (`obsidian-vm`) nao tem IP publico. Toda comunicacao externa passa por Cloud NAT (outbound-only para apt/npm/git). O acesso ao sistema e exclusivamente via [[wireguard-vpn]].

### Firewall deny-all

Regra padrao: deny-all. Apenas 3 regras explicitas:
- **WireGuard:** UDP 51820 (unica porta exposta)
- **Internal:** comunicacao dentro da VPC `obsidian-vpc` (subnet `10.0.0.0/24`)
- **IAP SSH:** acesso SSH via Identity-Aware Proxy (para deploy CI/CD)

A VPC default do GCP foi deletada como hardening adicional.

### PostgreSQL localhost-only

O [[banco-pgvector]] escuta somente em `127.0.0.1`. SSL e omitido intencionalmente -- nao ha rede entre client e server (ambos rodam na mesma VM). Conexao via TCP local.

### Secrets no Secret Manager

Nenhum segredo e hardcoded. Todos armazenados no GCP Secret Manager:
- `openai-api-key` (API da OpenAI)
- `pg-obsidian-password` (senha do PostgreSQL)
- `git-vault-token` (PAT do GitHub com escopo minimo)

Na VM, os secrets sao carregados em `.env` (que esta no `.gitignore`).

### Service accounts com least privilege

- `obsidian-vm-sa`: apenas `secretmanager.secretAccessor` + `logging.logWriter`
- `github-actions-deploy`: apenas roles IAP tunnel + compute instance admin + OS login

### Path traversal prevention

O [[mcp-server]] usa `safePath()` para prevenir path traversal em todas as operacoes de filesystem -- null byte injection, `../` e caminhos fora do vault sao rejeitados.

## Rotacao de chaves

- SA keys devem ser rotacionadas a cada 90 dias (proximo: 2026-06-05)
- Meta de longo prazo: migrar para Workload Identity Federation (keyless)

## Relacoes

- protege: [[banco-pgvector]], [[mcp-server]], [[infraestrutura-gcp]]
- implementa: [[wireguard-vpn]]
- parte de: [[arquitetura-geral]]
- contido em: [[_MOC]]

## References

- `CLAUDE.md` (secao Security)
- `docs/HANDOFF.md` (notas de sessao com detalhes de firewall)
