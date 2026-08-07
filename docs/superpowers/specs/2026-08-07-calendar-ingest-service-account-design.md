# Calendar Ingest via Service Account — cerimônias de time para o vault

**Status:** Draft
**Date:** 2026-08-07
**Author:** Eduardo (isorensen) + Claude Fable 5
**Issue:** TBD (será aberta após aprovação)

> **Aviso de fronteira open source.** Este repositório é público. Este documento descreve o
> *mecanismo* e não contém nenhum identificador real: e-mails, IDs de calendário, nomes de
> squad, domínio ou nome da conta de captura ficam **exclusivamente** em `~/.lox/config.json`,
> que é local e não versionado. Ao editar este spec, use sempre placeholders.

## Contexto

O modo pessoal do Lox já importa reuniões do Google Calendar para o vault: a skill
`sync-calendar` lê os calendários do usuário, procura no Gmail o e-mail de resumo do Gemini
(`gemini-notes@google.com`) e grava uma nota em `7 - Meeting Notes/`. Dois timers systemd na
VM rodam isso de manhã (captura os eventos) e à noite (captura os resumos que chegam depois
das reuniões).

Queremos o mesmo resultado para um vault de time (modo team, MCP sobre WireGuard), com uma
diferença estrutural: **o dono do vault não participa das reuniões que quer indexar**. São as
cerimônias das squads de engenharia — daily, planning, review, retro, baseline — que
acontecem sem ele.

Isso quebra o mecanismo atual. As notas do Gemini são distribuídas **aos convidados da
reunião**, não a quem tem acesso ao calendário. Quem não é convidado não recebe o e-mail e
não recebe permissão no Google Doc, mesmo sendo `owner` do calendário onde o evento vive.

## Descobertas que fundamentam o design

Levantamento feito em 01/06/2026–06/08/2026 sobre três calendários de engenharia:

1. **Acesso ao calendário é total; acesso ao conteúdo é nulo.** O `accessRole` é `owner` nos
   três calendários e o campo `attachments` dos eventos expõe os links dos Docs "Anotações do
   Gemini". Tentar ler esses Docs retorna `Requested entity was not found`. Uma reunião da
   qual o usuário participou abriu normalmente — o divisor é a participação, não o calendário.

2. **Estar convidado basta; comparecer não é necessário.** Foi observado um evento com
   `responseStatus: declined` cujo e-mail do Gemini chegou assim mesmo. Convite via Google
   Group também propaga (o e-mail explicita "you are part of a group that was invited").

3. **A cobertura do Gemini é irregular — 42% em junho, 49% em julho.** Uma das squads só grava
   a Sprint Planning; as outras cinco séries têm zero ocorrências em dois meses. Nenhuma
   Sprint Review de nenhuma squad foi gravada no período. Ligar "take notes for me" nas séries
   descobertas é pré-requisito do projeto e tem retorno maior que qualquer sofisticação no
   ingestor.

4. **Títulos colidem entre squads.** "Daily meeting" ocorre em duas squads no mesmo dia, com
   dez minutos de diferença. A canonicalização atual (`YYYY-MM-DD <título>.md`, desambiguada
   por turno) geraria o mesmo arquivo para as duas.

5. **O nome da squad no evento é instável.** O `organizer.displayName` do mesmo calendário
   aparece com três variações diferentes ao longo do período. Não serve como chave.

6. **O histórico começa em meados de 2025, não antes.** Amostragem trimestral de jan/2025 a
   abr/2026 mostra zero notas do Gemini em jan/2025 e abr/2025 nos três calendários — só
   anexos de gravação em vídeo. A primeira nota aparece em **jun/2025**; os outros dois
   calendários entram em jul/2025 e out/2025. O volume total da carga retroativa fica entre
   **70 e 85 eventos** (jun/2025 a ago/2026), concentrado nas cerimônias quinzenais e não nas
   dailies. É um volume pequeno: cabe numa única execução, sem particionamento.

7. **O título do anexo de notas varia.** Foram observadas ao menos três formas: `Anotações do
   Gemini`, o mesmo texto precedido de nome e data da reunião, e `Notes by Gemini` em inglês.
   Casar por igualdade exata perde eventos — foi o que aconteceu na primeira contagem de um
   dos calendários. O matching deve ser por substring case-insensitive cobrindo as variantes
   em português e inglês.

## Goals

- Ingerir todas as cerimônias dos calendários de engenharia configurados, com ou sem notas do
  Gemini, em um vault de time.
- Ler o conteúdo do Gemini **direto do Google Doc**, dispensando o caminho por e-mail.
- Suportar a mesma operação em duas janelas: carga retroativa (backfill) e execução diária.
- Manter o repositório público livre de qualquer identificador interno.
- Credencial de acesso sob Zero Trust: keyless, escopo mínimo, auditável, sem Gmail.

## Non-Goals

- Ingerir gravações em vídeo ou transcrição de chat do Meet. Elas existem nos três calendários
  e são bem mais antigas que as notas do Gemini — há gravações desde 2025 e antes, período em
  que não há nota nenhuma. Transcrevê-las é a **única** via para cobrir o histórico anterior a
  jun/2025, mas é outro projeto: exige serviço de transcrição, tem custo por hora de áudio e
  qualidade bem inferior à nota estruturada do Gemini. Fica como follow-up explícito.
- Resumir ou reescrever conteúdo com LLM. O Gemini já entrega o Doc estruturado; a conversão
  é mecânica e determinística.
- Substituir a skill `sync-calendar` no modo pessoal. Ela continua como está, com uma alteração
  pontual descrita adiante.
- Criar notas de pessoas automaticamente a partir de participantes.

## Arquitetura

```
Service Account (sem chave exportada)
  └── domain-wide delegation, impersona <capture-account>
        ├── Calendar API (readonly) ──> eventos dos calendários configurados
        └── Drive API   (readonly) ──> export do Doc "Anotações do Gemini"
                                            │
                                            v
                              ingestor (packages/core/src/ingest)
                                            │
                                            v
                                    vault (Markdown) ──> watcher ──> pgvector
```

A conta de captura (`<capture-account>`) é convidada às séries recorrentes das cerimônias. Ela
não precisa comparecer — o convite é o que garante o e-mail e a permissão no Doc. A service
account a impersona para ler; nenhuma credencial de pessoa física é usada.

Por que não reusar a skill: os conectores Google do Claude estão autenticados como o usuário,
não como a conta de captura, então a skill não enxergaria os dados dela. Além disso o caminho
headless (`claude -p` + conectores OAuth) já é documentado no repo como não validado ponta a
ponta e produziu falhas silenciosas antes — motivo pelo qual existe um runner que procura a
string `Sync complete` na saída. Um ingestor determinístico elimina essa classe de falha, é
testável com vitest e não consome tokens.

## Componentes

Todos sob `packages/core/src/ingest/`, com entrypoint em
`packages/core/src/scripts/ingest-calendar.ts`.

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `auth.ts` | Obtém token DWD keyless (assina JWT via IAM Credentials API) | metadata server |
| `calendar-source.ts` | Lista eventos de um calendário numa janela; normaliza o payload | `auth` |
| `gemini-doc.ts` | Acha o anexo de notas, exporta o Doc como texto, parseia as seções | `auth` |
| `note-builder.ts` | Evento + notas → Markdown; naming, Dataview, template | — |
| `vault-writer.ts` | Grava a nota; decide criar, complementar ou pular | `note-builder` |

`note-builder` é puro (entrada → string), o que torna naming e template testáveis sem rede.
`gemini-doc` isola o único parsing frágil do sistema, contra fixtures reais.

CLI:

```bash
npm run ingest-calendar -- --from 2026-06-01 --to 2026-06-30 --dry-run
npm run ingest-calendar -- --since yesterday
```

`--dry-run` imprime o que seria criado sem tocar no vault. É o modo padrão da primeira execução
de qualquer janela nova.

## Configuração e fronteira open source

Nada específico de organização entra no repositório. O repo ganha
`packages/core/config.json.example` com placeholders; a configuração real vive em
`~/.lox/config.json` (já coberto por `.gitignore`).

```jsonc
{
  "calendar_ingest": {
    "impersonate_subject": "<capture-account>@<domain>",
    "service_account": "<sa-name>@<project>.iam.gserviceaccount.com",
    "notes_folder": "7 - Meeting Notes",
    "calendars": [
      { "id": "<calendar-id>", "label": "<squad-label>" },
      { "id": "<calendar-id>", "label": "" }
    ]
  }
}
```

`label` é o sufixo de desambiguação do nome do arquivo e resolve a descoberta (5): ele vem da
configuração, não do evento, então é estável mesmo quando o organizador muda de nome. `label`
vazio significa "não sufixar" — usado em calendários cujos títulos já são únicos.

A documentação pública descreve o mecanismo (como criar a SA, quais escopos autorizar, como
convidar a conta de captura) sem citar nenhum valor real. Um operador de outra organização
consegue reproduzir; ninguém consegue inferir a topologia interna de times de quem usa.

## Segurança — Zero Trust

**Keyless por padrão.** A VM é GCE, então a service account é *anexada* à instância e o token
vem do metadata server. Para a impersonação, o processo chama
`iamcredentials.googleapis.com/.../:signJwt` em vez de assinar localmente — não existe arquivo
de chave privada em disco, nem no repo, nem no Secret Manager. Requer
`roles/iam.serviceAccountTokenCreator` sobre a própria SA.

Se em algum ambiente a chave exportada for inevitável, ela vai para o Secret Manager com TTL
máximo de 90 dias e rotação registrada — nunca em disco ou variável de ambiente persistida.

**Escopo mínimo.** Apenas dois escopos são autorizados no Admin Console, por client ID:

```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.readonly
```

**`gmail.readonly` é deliberadamente excluído.** Como lemos o Doc e não o e-mail, ele é
desnecessário — e é justamente o escopo que, sob domain-wide delegation, permitiria ler a caixa
de qualquer pessoa do domínio. Essa exclusão é a decisão de segurança mais relevante do design
e não deve ser revertida sem revisão explícita.

**Impersonação restrita.** A configuração aponta para uma única conta de captura. Vale registrar
com honestidade que DWD é uma capacidade ampla: tecnicamente a SA pode impersonar qualquer
conta do domínio dentro dos escopos concedidos. O controle real é a combinação de escopo
readonly restrito, ausência de Gmail, e auditoria — não a configuração da aplicação.

**Auditoria.** Acessos por DWD ficam registrados nos logs de auditoria do Workspace e nas
chamadas de `signJwt` no Cloud Audit Logs. A revisão desses logs entra no runbook operacional;
qualquer uso da SA fora da janela dos timers é anomalia.

**Transparência organizacional.** A conta de captura aparece na lista de convidados de cada
cerimônia. Isso é desejável, mas não substitui aviso: as equipes devem ser informadas de que as
cerimônias passarão a ser capturadas e indexadas antes do primeiro convite.

## Formato da nota

Caminho: `<notes_folder>/YYYY-MM-DD <Título> - <label>.md` (sufixo omitido quando `label` é
vazio). O formato segue o vault existente — texto puro com campos inline do Dataview, **sem
frontmatter YAML**.

```
[source:: google-calendar]
[imported:: YYYY-MM-DD]
[calendar_event_id:: <id>]
[calendar_source:: <label>]
[attendance:: observer]
```

`attendance` é novo e assume `accepted`, `declined`, `tentative`, `none` ou `observer`. Nas
cerimônias ingeridas por este pipeline o valor é sempre `observer` — a conta de captura foi
convidada mas não participa. O campo existe para permitir consultas Dataview do tipo "o que
aconteceu e eu não acompanhei".

Status da nota: `#child` quando há notas do Gemini, `#baby` quando é só o esqueleto.

O Doc do Gemini já vem seccionado em **Resumo**, **Próximas etapas** e **Detalhes**. O
`note-builder` mapeia essas seções para o template existente sem reescrever texto. Itens de
próxima etapa viram checkboxes com `[responsible::]` quando o Gemini nomeia o responsável.

Eventos podem ter **mais de um** anexo de notas — foi observado um evento com quatro. O
ingestor concatena todos, na ordem em que aparecem, sob subtítulos. Por isso o número de
documentos a exportar fica cerca de 15–20% acima do número de eventos.

A identificação do anexo é por **substring case-insensitive**, cobrindo as variantes conhecidas
(`anotações do gemini`, `notes by gemini`), porque o título vem com prefixos variáveis e às
vezes em inglês (descoberta 7). A lista de padrões é configurável, para que outros idiomas
possam ser adicionados sem alterar código.

## Idempotência

A chave é `calendar_event_id`. Antes de escrever, o ingestor lê o caminho canônico:

- Arquivo ausente → cria.
- Existe com o mesmo `calendar_event_id` → compara. Se a nota é esqueleto (`#baby`) e agora há
  notas do Gemini, complementa e promove para `#child`. Caso contrário, pula.
- Existe com `calendar_event_id` diferente → colisão de nome entre eventos distintos;
  desambigua com sufixo de horário `(HH-MM)`.

A busca textual do MCP não é usada como fonte de verdade para dedupe: ela é `ILIKE` sobre
conteúdo chunkado e pode retornar zero para um ID que existe. A leitura do caminho canônico é
determinística e O(1).

Isso torna a execução diária segura de repetir e o backfill seguro de re-rodar.

## Tratamento de erros

| Situação | Comportamento |
|---|---|
| Evento sem anexo de notas | Cria esqueleto `#baby`. Não é erro. |
| Doc inacessível (403/404) | Registra aviso com o ID do evento, cria `#baby`, **continua**. |
| Falha de autenticação | Aborta imediatamente com código diferente de zero. |
| Rate limit da API | Backoff exponencial, até 3 tentativas; depois falha a janela. |
| Vault indisponível | Aborta antes de processar qualquer evento. |

Doc inacessível é o sinal mais importante do sistema: significa que a conta de captura não foi
convidada àquela série. O resumo final da execução lista essas ocorrências agrupadas por série,
para virar ação de calendário.

Toda execução termina imprimindo um resumo com criadas, complementadas, puladas e avisos.
Diferente do runner atual, o código de saída é confiável — não é preciso procurar string
mágica na saída para saber se funcionou.

## Testes

Alvo do projeto: 80% de cobertura, TDD.

- `note-builder`: canonicalização de título, aplicação e omissão do sufixo, desambiguação por
  colisão, template com e sem Gemini, múltiplos anexos, `attendance`.
- `gemini-doc`: parsing das três seções contra fixtures reais anonimizadas; Doc malformado;
  Doc vazio.
- `vault-writer`: criação, complemento de `#baby`, skip de `#child`, colisão de nomes.
- `calendar-source`: normalização, paginação, janela.
- `auth`: mockado; não faz rede em teste.

Fixtures de Doc do Gemini são anonimizadas antes de entrar no repo (nomes, e-mails e conteúdo
substituídos), pelo mesmo motivo da fronteira open source.

## Rollout

As fases são sequenciais e cada uma é verificável isoladamente.

| Fase | O que | Verificação |
|---|---|---|
| 0 | Ligar "take notes for me" nas séries descobertas sem gravação | Próxima ocorrência gera anexo |
| 1 | Convidar a conta de captura às séries | Ela recebe e-mail do Gemini e abre o Doc |
| 2 | Criar SA, habilitar DWD com os dois escopos readonly | Script lista eventos e exporta um Doc |
| 3 | Ingestor com `--dry-run` numa janela de 3 dias | Saída bate com o calendário |
| 4 | Backfill de jun/2025 até hoje | Notas criadas, sem duplicatas ao re-rodar |
| 5 | Timer diário no vault de time | Execução automática por uma semana |

O backfill cobre **jun/2025 em diante** porque antes disso não existem notas do Gemini nesses
calendários (descoberta 6). São 70–85 eventos, volume que roda de uma vez.

O backfill precisa impersonar quem era convidado à época, e o organizador varia entre séries.
Em vez de fixar uma conta, ele impersona o `organizer.email` de cada evento, restrito a uma
allowlist na configuração. Isso evita lacunas sem precisar mapear manualmente quem participou
de quê. A allowlist é o limite: uma conta fora dela faz o evento ser pulado com aviso, nunca
uma impersonação silenciosa.

A fase 1 é o gate real: se a conta de captura não receber as notas, nada adiante funciona.
Vale validar em **uma única série** antes de editar todas — a Sprint Review é boa candidata
porque hoje não tem gravação nenhuma, então exercita as fases 0 e 1 juntas.

O backfill (fase 4) vem depois do incremental estar de pé, e não antes: é o mesmo código com
outra janela, então não faz sentido validá-lo primeiro. O retorno do retroativo é modesto —
pela cobertura medida, boa parte das ocorrências antigas simplesmente não tem notas.

## Mudança na skill `sync-calendar` (vault pessoal)

Independente do ingestor, e a pedido: a skill **deixa de pular eventos declinados**. Em vez de
descartar, grava a nota com `[attendance:: declined]`. O mesmo vale para eventos opcionais sem
resposta (`none`). O objetivo é poder acompanhar por Dataview o que aconteceu sem participação.

Os filtros de ruído real permanecem: `workingLocation`, aniversários e all-day sem participantes.

Nota de higiene: a versão instalada da skill tem endereços de e-mail escritos direto no corpo do
arquivo, enquanto a versão versionada no repo lê calendários da configuração. Ao sincronizar a
skill entre máquina e VM, a direção importa — copiar a instalada por cima da versionada vazaria
esses endereços no repositório público. A skill versionada deve permanecer sem identificadores.

## Riscos

| Risco | Mitigação |
|---|---|
| Conta de captura não recebe notas sem licença própria do Gemini | Validado na fase 1, em uma série, antes de qualquer investimento |
| DWD é capacidade ampla e chama atenção em auditoria | Escopos readonly, sem Gmail, keyless, auditoria documentada |
| Formato do Doc do Gemini muda | Parsing isolado em um módulo, coberto por fixtures; falha degrada para `#baby`, não quebra a execução |
| Ruído no vault compartilhado (metade dos eventos sem notas) | Fase 0 eleva a cobertura antes da ingestão; `#baby` é filtrável por Dataview |
| Vazamento de identificadores no repo público | Configuração externa, `.example` com placeholders, fixtures anonimizadas |
| Séries recorrentes se dividem e mudam de ID | Dedupe por `calendar_event_id` da ocorrência, não da série |

## Questões em aberto

- Acesso SSH à VM de time ainda não resolvido (a porta responde, mas nenhuma chave local é
  aceita). Necessário para instalar os timers na fase 5.
- Definir se o backfill roda a partir da VM ou de máquina local — a SA anexada favorece a VM.
