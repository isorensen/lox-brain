2026-03-14 11:06

Status: #baby

Tags: [[claude-skill]] [[lox]] [[seguranca]] [[vpn]]
source: claude-skill

# Modelo Zero Trust do Lox

O Lox adota postura Zero Trust em todas as camadas: nenhum componente e confiavel por padrao, todo acesso e autenticado e autorizado, e a superficie de ataque e minimizada ao extremo.

## Principios aplicados

### Sem IP publico

A VM (`obsidian-vm`, futuramente `lox-vm`) nao tem IP publico. Toda comunicacao externa passa por Cloud NAT (outbound-only para apt/npm/git). O acesso ao sistema e exclusivamente via [[Lox - WireGuard VPN]].

### Firewall deny-all

Regra padrao: deny-all. Apenas 3 regras explicitas:
- **WireGuard:** UDP 51820 (unica porta exposta)
- **Internal:** comunicacao dentro da VPC `obsidian-vpc` (subnet `10.0.0.0/24`) — futuramente `lox-vpc`
- **IAP SSH:** acesso SSH via Identity-Aware Proxy (para deploy CI/CD)

A VPC default do GCP foi deletada como hardening adicional.

### PostgreSQL localhost-only

O [[Lox - Banco pgvector]] escuta somente em `127.0.0.1`. SSL e omitido intencionalmente -- nao ha rede entre client e server (ambos rodam na mesma VM). Conexao via TCP local.

### Secrets no Secret Manager

Nenhum segredo e hardcoded. Todos armazenados no GCP Secret Manager:
- `openai-api-key` (API da OpenAI)
- `pg-obsidian-password` (senha do PostgreSQL)
- `git-vault-token` (PAT do GitHub com escopo minimo)

Na VM, os secrets sao carregados de `/etc/lox/secrets.env` (chmod 640, root:<user> — nao mais `.env` no repo).

### Service accounts com least privilege

- `<your-vm-sa>`: apenas `secretmanager.secretAccessor` + `logging.logWriter`
- `<your-deploy-sa>`: apenas roles IAP tunnel + compute instance admin + OS login

### Path traversal prevention

O [[Lox - MCP Server]] usa `safePath()` para prevenir path traversal em todas as operacoes de filesystem -- null byte injection, `../` e caminhos fora do vault sao rejeitados.

## Rotacao de chaves

- SA keys devem ser rotacionadas a cada 90 dias (proximo: <your-rotation-date>)
- Meta de longo prazo: migrar para Workload Identity Federation (keyless)

## Relacoes

- protege: [[Lox - Banco pgvector]], [[Lox - MCP Server]], [[Lox - Infraestrutura GCP]]
- implementa: [[Lox - WireGuard VPN]]
- parte de: [[Lox - Arquitetura Geral]]
- contido em: [[Lox]]

## References

- `CLAUDE.md` (secao Security)
- `docs/HANDOFF.md` (notas de sessao com detalhes de firewall)
