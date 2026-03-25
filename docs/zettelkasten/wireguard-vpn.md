2026-03-14 11:08

Status: #baby

Tags: [[claude-skill]] [[open-brain]] [[vpn]] [[seguranca]]
source: claude-skill

# WireGuard VPN do Open Brain

O WireGuard e o unico ponto de acesso ao sistema Open Brain. Cria um tunnel criptografado entre os clients (maquinas do usuario) e a VM GCP, sem expor nenhum servico na internet publica.

## Topologia da rede

```
VM (server):     10.10.0.1/24  (wg0, porta UDP 51820)
Arch Linux:      10.10.0.2/24  (client 1)
Mac:             10.10.0.3/24  (client 2)
```

O IP estatico da VM (`34.75.93.58`) e o unico ponto exposto, e somente na porta UDP 51820 -- controlado pela regra de firewall do GCP.

## Split tunnel

Configurado como split tunnel: somente trafego destinado a `10.10.0.0/24` passa pela VPN. O restante do trafego do client vai direto pela internet local. Isso minimiza latencia para uso geral e reduz carga na VM.

## Latencia

~153ms (Brasil para us-east1). Aceitavel para operacoes MCP (busca semantica, leitura/escrita de notas) que nao sao real-time.

## Conexao do Claude Code

O Claude Code acessa o [[Open Brain - MCP Server]] via SSH pela VPN:

```
Host obsidian-vm
  HostName 10.10.0.1
  IdentityFile ~/.ssh/google_compute_engine
```

O MCP Server e invocado sob demanda -- nao e um daemon. Cada sessao do Claude Code abre uma conexao SSH, inicia o server, e usa stdio como transporte.

## Multi-client

A rede suporta multiplos clients simultaneamente. Cada device tem seu proprio par de chaves WireGuard e IP fixo na rede `10.10.0.0/24`. A comunicacao e bidirecional -- server consegue alcancar clients e vice-versa.

## Relacoes

- protege acesso a: [[Open Brain - MCP Server]], [[Open Brain - Infraestrutura GCP]]
- parte do modelo: [[Open Brain - Seguranca Zero Trust]]
- viabiliza: [[Open Brain - Arquitetura Geral]]
- contido em: [[Open Brain]]

## References

- `docs/HANDOFF.md` (notas de sessao Fase 2)
