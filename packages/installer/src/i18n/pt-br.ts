import type { I18nStrings } from './en.js';

export const ptBr: I18nStrings = {
  // Language selection
  language_prompt: 'Selecione o idioma:',
  language_english: 'English',
  language_portuguese: 'Portugues (BR)',

  // Splash
  splash_description: 'Segundo Cerebro pessoal com IA e busca semantica.',
  splash_features: 'Obsidian + pgvector + MCP Server + Claude Skills + WireGuard VPN',

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
  success_step_2: 'Verifique o tunel VPN: ping o IP do servidor VPN (mostrado na configuracao)',
  success_step_3: 'Peca ao Claude Code para buscar em suas notas — isso verifica a stack completa.',
  success_status_hint: 'VPN nao conecta? Verifique se o WireGuard esta ativo e tente o ping novamente.',

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
  step_mode: 'Seleção de Modo',
  mode_prompt: 'Escolha o modo de instalação:',
  mode_personal: 'Pessoal',
  mode_personal_desc: 'Usuário único — seu Segundo Cérebro pessoal.',
  mode_team: 'Equipe',
  mode_team_desc: 'Multi-usuário — cérebro compartilhado para a equipe (requer chave de licença).',

  // License
  step_license: 'Chave de Licença',
  license_prompt: 'Insira sua chave de licença Lox Team:',
  license_valid: 'Licença validada com sucesso.',
  license_invalid: 'Chave de licença inválida ou expirada. Tente novamente.',
  license_org: 'Organização',
  license_max_peers: 'Max peers',
  license_expires: 'Expira em',

  // Peers
  step_peers: 'Peers da Equipe',
  peers_count_prompt: 'Quantos membros na equipe (excluindo o servidor)?',
  peers_name_prompt: 'Nome do peer',
  peers_email_prompt: 'Email do peer',
  peers_generating: 'Gerando pares de chaves WireGuard...',
  peers_generated: 'Pares de chaves gerados para todos os peers.',
  peers_conf_written: 'Arquivos de configuração WireGuard escritos em output/',

  // VM setup
  vm_setup_timeout: 'A configuracao da VM esta demorando mais que o esperado. Continuar aguardando?',
  install_timeout_extend: 'esta demorando mais que o esperado. Continuar aguardando?',
  vm_phase_system_update: 'Atualizando pacotes do sistema',
  vm_phase_nodejs: 'Instalando Node.js 22',
  vm_phase_postgresql: 'Instalando PostgreSQL 16',
  vm_phase_pgvector: 'Compilando extensao pgvector',
  vm_phase_db_setup: 'Criando banco de dados e schema',
  vm_phase_ssh_hardening: 'Fortalecendo configuracao SSH',
  vm_phase_wireguard: 'Instalando WireGuard',
  vm_phase_fetching_logs: 'Buscando logs da VM para diagnostico',
  vm_ssh_warmup: 'Estabelecendo conexao SSH com a VM',

  // OpenAI API key prompt
  openai_explain_title: 'Chave da API OpenAI necessaria',
  openai_explain_body: 'O Lox usa embeddings da OpenAI para indexar seu vault. Crie uma chave em:',
  openai_paste_prompt: 'Cole sua chave da API OpenAI (a entrada ficara oculta):',
  openai_invalid_format: 'Isto nao parece uma chave valida da API OpenAI',
  openai_skipping_after_retries: 'Muitas tentativas invalidas — pulando. Voce pode configurar manualmente depois.',
  openai_existing_prompt: 'Ja existe um secret openai-api-key neste projeto. O que voce quer fazer?',
  openai_option_reuse: 'Reutilizar a chave existente do Secret Manager',
  openai_option_replace: 'Substituir por uma chave nova',
  openai_option_skip: 'Pular (vou injetar a chave manualmente)',
  openai_saved_to_secret_manager: 'Chave da API OpenAI salva no GCP Secret Manager',
  openai_keep_trying_prompt: 'Foram 5 tentativas invalidas. Continuar tentando?',
  openai_skipped_warning: 'Chave da API OpenAI NAO configurada. O watcher nao conseguira embedar notas ate voce configurar manualmente.',

  // Resume installer
  resume_found_title: 'Uma instalacao anterior foi encontrada',
  resume_found_subtitle: 'Voce pode continuar de onde parou, escolher um passo especifico ou comecar do zero.',
  resume_last_completed: 'Ultimo passo concluido',
  resume_failed_at: 'Falhou no passo',
  resume_saved_at: 'Salvo em',
  resume_prompt: 'Como voce quer prosseguir?',
  resume_option_continue: 'Continuar de onde parou',
  resume_option_pick_step: 'Escolher um passo especifico para reiniciar',
  resume_option_restart: 'Comecar uma instalacao do zero (descartar estado salvo)',
  resume_pick_step_prompt: 'Selecione o passo para reiniciar:',
  resume_starting_from: 'Retomando a partir do passo',
  resume_cleared: 'Estado anterior do instalador descartado.',

  // Error reporting
  error_report_prompt: 'Gostaria de reportar este problema no GitHub?',
  error_report_creating: 'Criando relatorio do problema...',
  error_report_created: 'Issue criada:',
  error_report_failed: 'Nao foi possivel criar o relatorio',
  error_report_note: 'Dados pessoais foram removidos do relatorio',
};
