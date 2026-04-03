> **Historical document from the pre-Lox era.** This is the original architecture brainstorm written before implementation began. Many details (e.g., region, VM specs, cost estimates) were superseded during build. See `docs/handoff-2026-04-03.md` for the current state of the Lox project.

---

# Handoff Técnico — Arquitetura Obsidian CLI + Claude Code + Google Cloud

Autor: Eduardo Sorensen  
Objetivo: Construir uma infraestrutura privada, segura e sob demanda para acessar, consultar e escrever notas no **Obsidian Vault** utilizando **Obsidian CLI** e **Claude Code**, acessível por interface web privada e VPN.

---

# 1. Princípios do Projeto

## Premissa principal
**Segurança é inegociável.**

Mesmo que aumente a complexidade do sistema, as seguintes regras devem ser seguidas:

acesso apenas via VPN
autenticação forte
rotação de chaves
logs auditáveis
infraestrutura minimamente exposta à internet
possibilidade de pentest interno e externo

Nenhuma decisão arquitetural pode comprometer a segurança das chaves ou dados do vault.

---

# 2. Objetivo do Sistema

Permitir que o usuário:

consulte notas do Obsidian
registre novas notas
escreva ideias e artigos
faça buscas semânticas
execute automações via Claude Code
utilize tudo isso remotamente (celular ou desktop)

Sem expor diretamente o vault na internet.

---

# 3. Arquitetura Geral

Arquitetura baseada em Google Cloud.

Componentes principais:

Usuário (celular / computador)  
│  
│ VPN (WireGuard)  
│  
▼  
Painel Web (Cloud Run)  
│  
│ API Google Cloud  
│  
▼  
VM Obsidian (Compute Engine)  
│  
├─ Obsidian CLI  
├─ Claude Code (Anthropic)  
├─ Git Vault Sync  
└─ Backup Google Drive  

---

# 4. Infraestrutura Cloud

## Região

Inicialmente:

us-central1 (Iowa)

Motivo:

custo significativamente menor
latência aceitável
infraestrutura madura

---

# 5. VM Principal (Obsidian Node)

Serviço:

Google Compute Engine

Configuração inicial recomendada:

1 vCPU  
4 GB RAM  
SSD padrão  
Ubuntu LTS  

Possível upgrade futuro:

2 vCPU  
8 GB RAM  

---

# 6. Ciclo de Vida da VM

Para reduzir custos, a VM **não roda 24/7**.

Fluxo:

1. Usuário acessa painel  
2. Painel chama API Google Cloud  
3. VM é iniciada  
4. Usuário executa operações  
5. Timer idle é iniciado  
6. VM desliga automaticamente após inatividade  

Tempo de boot estimado:

30 a 60 segundos

Idle shutdown recomendado:

30–60 minutos

Também deve existir endpoint para desligamento imediato.

---

# 7. Interface de Controle

Serviço:

Google Cloud Run

Funções do painel:

iniciar VM
desligar VM
verificar status
executar comandos
interface simplificada para notas

Autenticação:

Google IAM

Acesso restrito ao usuário proprietário.

---

# 8. VPN Privada

Tecnologia escolhida:

WireGuard

Motivos:

open source
extremamente rápido
código pequeno
criptografia moderna
amplamente auditado

---

## Servidor VPN

Pode rodar em:

VM pequena dedicada  
ou  
na própria VM Obsidian  

Recomendação inicial:

VM pequena dedicada.

Configuração sugerida:

e2-micro

Custo aproximado:

$5–10 / mês

---

## Acesso

Clientes configurados em:

celular
laptop
desktop

Autenticação baseada em:

chave privada WireGuard

---

# 9. VM Obsidian — Serviços Internos

A VM principal executa:

Obsidian CLI
Claude Code
Scripts de automação
Git sync
Rotinas de backup

---

# 10. Obsidian CLI

Executa operações como:

busca em notas
criação de notas
edição
templates
indexação

Executado via scripts internos chamados pelo Claude Code.

---

# 11. Claude Code (Anthropic)

Claude Code rodará **na mesma VM**.

Motivo:

acesso direto ao filesystem
baixa latência
execução local de ferramentas

Claude Code será responsável por:

interpretar prompts
decidir ações
executar comandos CLI
consultar notas
gerar textos
escrever arquivos markdown

---

## Autenticação Anthropic

Configuração via:

API key

Armazenada em:

Secret Manager  
ou  
variáveis de ambiente seguras  

Nunca hardcoded.

---

# 12. Integração com Vault

O vault do Obsidian será mantido via **Git**.

Fonte primária:

GitHub Private Repository

Na VM:

git clone vault

Sincronização periódica:

git pull  
git push  

Pode ser feita:

por cron
após alterações
manualmente via endpoint

---

# 13. Backup adicional

Além do Git, haverá backup em:

Google Drive

Motivo:

redundância
recuperação rápida
camada extra de segurança

Estratégia:

sync vault → Google Drive

Ferramentas possíveis:

rclone
gdrive CLI
Google Drive API

---

# 14. Segurança

Requisitos obrigatórios:

## Acesso

apenas via VPN
nenhuma porta pública aberta
firewall restritivo

---

## Segredos

armazenados em Secret Manager
nunca commitados em Git

---

## Logs

Registrar:

comandos executados
acessos
ações do Claude Code

Ferramentas possíveis:

Cloud Logging  
audit logs  
shell logs  

---

## Rotação de chaves

Implementar política para:

WireGuard keys
API keys
Git tokens

---

## Pentest

Sistema deve permitir:

pentest interno
pentest externo controlado

---

# 15. Monitoramento

Ferramentas possíveis:

Cloud Monitoring  
Cloud Logging  
Alertas automáticos  

Eventos monitorados:

login VPN
execução de comandos
erros Claude Code
status da VM
falhas de sincronização

---

# 16. Fluxo de Uso

Fluxo típico:

1. usuário abre painel  
2. inicia VM  
3. conecta via VPN  
4. envia comando  
5. Cloud Run envia prompt  
6. Claude Code interpreta  
7. executa Obsidian CLI  
8. retorna resultado  
9. VM entra em idle  
10. VM desliga automaticamente  

---

# 17. Estimativa de Custos

## VM Obsidian

Região Iowa

$20–40 / mês se rodar 24h

Com auto shutdown:

$5–10 / mês

---

## VPN VM

$5–10 / mês

---

## Cloud Run

Praticamente zero.  
Cobrança apenas por requisição.

---

## Total estimado

$10 – $25 / mês

---

# 18. Próximos Passos

Ordem sugerida de implementação:

1. Criar VPC  
2. Criar VM Obsidian  
3. Instalar WireGuard  
4. Configurar VPN  
5. Clonar vault Git  
6. Instalar Obsidian CLI  
7. Instalar Claude Code  
8. Criar scripts de integração  
9. Criar painel Cloud Run  
10. Implementar logs e segurança  

---

# 19. Melhorias Futuras

Possíveis evoluções:

indexação vetorial das notas
busca semântica avançada
memória persistente
automação de escrita
integração com agenda
integração com tarefas
agente de conhecimento pessoal

---

# 20. Status do Projeto

Fase atual:

Arquitetura definida

Próximo passo:

Implementação da infraestrutura base

---

# Fim do Documento

