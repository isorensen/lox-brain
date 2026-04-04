import type { I18nStrings } from './en.js';

export const ptBr: I18nStrings = {
  // Language selection
  language_prompt: 'Selecione o idioma:',
  language_english: 'English',
  language_portuguese: 'Portugues (BR)',

  // Splash
  splash_description: 'Segundo Cerebro pessoal com IA e busca semantica.',
  splash_features: 'Obsidian + pgvector + MCP Server + WireGuard VPN',

  // Steps
  step_prefix: 'Passo',
  step_prerequisites: 'Pre-requisitos',
  step_security_audit: 'Auditoria de Seguranca',
  step_language: 'Idioma',
  step_vault_preset: 'Preset do Vault',
  step_gcp_project: 'Projeto GCP',
  step_vpc_network: 'Rede VPC',
  step_vm_instance: 'Instancia VM',
  step_wireguard: 'WireGuard VPN',
  step_postgresql: 'PostgreSQL + pgvector',
  step_git_sync: 'Sincronizacao Git',
  step_embedding: 'Servico de Embedding',
  step_mcp: 'Servidor MCP',

  // Security audit
  security_audit_title: 'Auditoria de Seguranca',
  security_audit_passed: 'Todas as verificacoes de seguranca passaram.',
  security_audit_failed: 'Problemas de seguranca detectados. Corrija antes de continuar.',
  security_hygiene_title: 'Lembretes de Higiene de Seguranca',
  security_rule_1: 'Sem IPs publicos em bancos de dados do vault',
  security_rule_1_detail: 'PostgreSQL escuta apenas em localhost (127.0.0.1).',
  security_rule_2: 'Gestao de segredos e tokens',
  security_rule_2_detail: 'Chaves de API e tokens armazenados no GCP Secret Manager, nunca hardcoded.',
  security_rule_3: 'Acesso apenas via VPN',
  security_rule_3_detail: 'Todos os servicos acessiveis apenas pelo tunel WireGuard VPN.',

  // Success
  success_title: 'Lox esta pronto.',
  success_subtitle: 'Seu Segundo Cerebro esta online.',
  success_vault: 'Vault sincronizado e indexado',
  success_mcp: 'Servidor MCP rodando na VPN',
  success_claude: 'Claude Code conectado',
  success_next_steps: 'Proximos Passos',
  success_step_1: 'Abra o Obsidian e verifique a sincronizacao do vault.',
  success_step_2: 'Execute "lox status" para verificar todos os servicos.',
  success_step_3: 'Peca ao Claude Code para buscar em suas notas.',
  success_status_hint: 'Execute "lox status" a qualquer momento para verificar a saude do sistema.',

  // Prompts
  press_enter: 'Pressione Enter para continuar...',
  estimated_cost: 'Custo mensal estimado: ~$7 USD (GCP e2-small)',
  billing_instructions_1: 'Acesse console.cloud.google.com',
  billing_instructions_2: 'Crie ou selecione um projeto',
  billing_instructions_3: 'Ative o faturamento para o projeto',
  billing_instructions_4: 'Ative a API do Compute Engine',
  billing_instructions_5: 'Execute "gcloud auth login" para autenticar',

  // Status
  checking: 'Verificando',
  installing: 'Instalando',
  creating: 'Criando',
  configuring: 'Configurando',
  done: 'Concluido',
  failed: 'Falhou',
  skipped: 'Ignorado',

  // Errors
  error_prefix: 'Erro',
  confirm_continue: 'Deseja continuar mesmo assim?',

  // Presets
  preset_zettelkasten: 'Zettelkasten',
  preset_zettelkasten_desc: 'Notas atomicas com IDs unicos, interligadas para pensamento emergente.',
  preset_para: 'PARA',
  preset_para_desc: 'Projetos, Areas, Recursos, Arquivos — organizacao orientada a acao.',

  // Billing
  billing_checking: 'Verificando conta de faturamento...',
  billing_not_linked: 'Nenhuma conta de faturamento vinculada ao projeto',
  billing_select_account: 'Selecione uma conta de faturamento:',
  billing_no_accounts: 'Nenhuma conta de faturamento encontrada. Crie uma em:',
  billing_press_enter: 'Pressione Enter apos criar uma conta de faturamento',
  billing_linked_success: 'Conta de faturamento vinculada com sucesso',
  billing_required_for_apis: 'Faturamento e necessario para ativar APIs do GCP. Vincule uma conta e tente novamente.',
  billing_linking: 'Vinculando conta de faturamento...',

  // Modes
  mode_personal: 'Pessoal',
  mode_team: 'Equipe',
};
