export interface I18nStrings {
  // Language selection
  language_prompt: string;
  language_english: string;
  language_portuguese: string;

  // Splash
  splash_description: string;
  splash_features: string;

  // Steps
  step_prefix: string;
  step_prerequisites: string;
  step_security_audit: string;
  step_language: string;
  step_vault_preset: string;
  step_gcp_project: string;
  step_vpc_network: string;
  step_vm_instance: string;
  step_wireguard: string;
  step_postgresql: string;
  step_git_sync: string;
  step_embedding: string;
  step_mcp: string;

  // Security audit
  security_audit_title: string;
  security_audit_passed: string;
  security_audit_failed: string;
  security_hygiene_title: string;
  security_rule_1: string;
  security_rule_1_detail: string;
  security_rule_2: string;
  security_rule_2_detail: string;
  security_rule_3: string;
  security_rule_3_detail: string;

  // Success
  success_title: string;
  success_subtitle: string;
  success_vault: string;
  success_mcp: string;
  success_claude: string;
  success_next_steps: string;
  success_step_1: string;
  success_step_2: string;
  success_step_3: string;
  success_status_hint: string;

  // Prompts
  press_enter: string;
  estimated_cost: string;
  billing_instructions_1: string;
  billing_instructions_2: string;
  billing_instructions_3: string;
  billing_instructions_4: string;
  billing_instructions_5: string;

  // Status
  checking: string;
  installing: string;
  creating: string;
  configuring: string;
  done: string;
  failed: string;
  skipped: string;

  // Errors
  error_prefix: string;
  confirm_continue: string;

  // Presets
  preset_zettelkasten: string;
  preset_zettelkasten_desc: string;
  preset_para: string;
  preset_para_desc: string;

  // Billing
  billing_checking: string;
  billing_not_linked: string;
  billing_select_account: string;
  billing_no_accounts: string;
  billing_press_enter: string;
  billing_linked_success: string;
  billing_required_for_apis: string;
  billing_linking: string;

  // Modes
  mode_personal: string;
  mode_team: string;

  // VM setup
  vm_setup_timeout: string;
  install_timeout_extend: string;
  vm_phase_system_update: string;
  vm_phase_nodejs: string;
  vm_phase_postgresql: string;
  vm_phase_pgvector: string;
  vm_phase_db_setup: string;
  vm_phase_ssh_hardening: string;
  vm_phase_wireguard: string;
  vm_phase_fetching_logs: string;
  vm_ssh_warmup: string;

  // OpenAI API key prompt
  openai_explain_title: string;
  openai_explain_body: string;
  openai_paste_prompt: string;
  openai_invalid_format: string;
  openai_skipping_after_retries: string;
  openai_existing_prompt: string;
  openai_option_reuse: string;
  openai_option_replace: string;
  openai_option_skip: string;
  openai_saved_to_secret_manager: string;
  openai_keep_trying_prompt: string;
  openai_skipped_warning: string;

  // Resume installer
  resume_found_title: string;
  resume_found_subtitle: string;
  resume_last_completed: string;
  resume_failed_at: string;
  resume_saved_at: string;
  resume_prompt: string;
  resume_option_continue: string;
  resume_option_pick_step: string;
  resume_option_restart: string;
  resume_pick_step_prompt: string;
  resume_starting_from: string;
  resume_cleared: string;

  // Error reporting
  error_report_prompt: string;
  error_report_creating: string;
  error_report_created: string;
  error_report_failed: string;
  error_report_note: string;
}

export const en: I18nStrings = {
  // Language selection
  language_prompt: 'Select your language:',
  language_english: 'English',
  language_portuguese: 'Portugues (BR)',

  // Splash
  splash_description: 'Personal AI-powered Second Brain with semantic search.',
  splash_features: 'Obsidian + pgvector + MCP Server + Claude Skills + WireGuard VPN',

  // Steps
  step_prefix: 'Step',
  step_prerequisites: 'Prerequisites',
  step_security_audit: 'Security Audit',
  step_language: 'Language',
  step_vault_preset: 'Vault Preset',
  step_gcp_project: 'GCP Project',
  step_vpc_network: 'VPC Network',
  step_vm_instance: 'VM Instance',
  step_wireguard: 'WireGuard VPN',
  step_postgresql: 'PostgreSQL + pgvector',
  step_git_sync: 'Git Sync',
  step_embedding: 'Embedding Service',
  step_mcp: 'MCP Server',

  // Security audit
  security_audit_title: 'Security Audit',
  security_audit_passed: 'All security checks passed.',
  security_audit_failed: 'Security audit failed. Please fix issues before continuing.',
  security_hygiene_title: 'Security Hygiene Reminders',
  security_rule_1: 'No public IPs on vault databases',
  security_rule_1_detail: 'PostgreSQL listens on localhost only (127.0.0.1).',
  security_rule_2: 'Secrets and token management',
  security_rule_2_detail: 'API keys and tokens stored in GCP Secret Manager, never hardcoded.',
  security_rule_3: 'VPN-only access',
  security_rule_3_detail: 'All services accessible only via WireGuard VPN tunnel.',

  // Success
  success_title: 'Lox is ready.',
  success_subtitle: 'Your Second Brain is online.',
  success_vault: 'Vault synced and indexed',
  success_mcp: 'MCP Server running on VPN',
  success_claude: 'Claude Code connected',
  success_next_steps: 'Next Steps',
  success_step_1: 'Open Obsidian and verify vault sync.',
  success_step_2: 'Verify the VPN tunnel: ping 10.10.0.1',
  success_step_3: 'Ask Claude Code to search your notes — this verifies the full stack.',
  success_status_hint: 'VPN not connecting? Check WireGuard is active and retry the ping.',

  // Prompts
  press_enter: 'Press Enter to continue...',
  estimated_cost: 'Estimated monthly cost: ~$7 USD (GCP e2-small)',
  billing_instructions_1: 'Go to console.cloud.google.com',
  billing_instructions_2: 'Create or select a project',
  billing_instructions_3: 'Enable billing for the project',
  billing_instructions_4: 'Enable Compute Engine API',
  billing_instructions_5: 'Run "gcloud auth login" to authenticate',

  // Status
  checking: 'Checking',
  installing: 'Installing',
  creating: 'Creating',
  configuring: 'Configuring',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',

  // Errors
  error_prefix: 'Error',
  confirm_continue: 'Do you want to continue anyway?',

  // Presets
  preset_zettelkasten: 'Zettelkasten',
  preset_zettelkasten_desc: 'Atomic notes with unique IDs, interlinked for emergent thinking.',
  preset_para: 'PARA',
  preset_para_desc: 'Projects, Areas, Resources, Archives — action-oriented organization.',

  // Billing
  billing_checking: 'Checking billing account...',
  billing_not_linked: 'No billing account linked to project',
  billing_select_account: 'Select a billing account:',
  billing_no_accounts: 'No billing accounts found. Create one at:',
  billing_press_enter: 'Press Enter after creating a billing account',
  billing_linked_success: 'Billing account linked successfully',
  billing_required_for_apis: 'Billing is required to enable GCP APIs. Please link a billing account and try again.',
  billing_linking: 'Linking billing account...',

  // Modes
  mode_personal: 'Personal',
  mode_team: 'Team',

  // VM setup
  vm_setup_timeout: 'VM setup is taking longer than expected. Continue waiting?',
  install_timeout_extend: 'taking longer than expected. Continue waiting?',
  vm_phase_system_update: 'Updating system packages',
  vm_phase_nodejs: 'Installing Node.js 22',
  vm_phase_postgresql: 'Installing PostgreSQL 16',
  vm_phase_pgvector: 'Compiling pgvector extension',
  vm_phase_db_setup: 'Creating database and schema',
  vm_phase_ssh_hardening: 'Hardening SSH configuration',
  vm_phase_wireguard: 'Installing WireGuard',
  vm_phase_fetching_logs: 'Fetching VM logs for diagnosis',
  vm_ssh_warmup: 'Establishing SSH connection to VM',

  // OpenAI API key prompt
  openai_explain_title: 'OpenAI API key required',
  openai_explain_body: 'Lox uses OpenAI embeddings to index your vault. Create an API key at:',
  openai_paste_prompt: 'Paste your OpenAI API key (input will be hidden):',
  openai_invalid_format: 'That does not look like a valid OpenAI API key',
  openai_skipping_after_retries: 'Too many invalid attempts — skipping. You can set the key manually later.',
  openai_existing_prompt: 'An openai-api-key secret already exists in this project. What do you want to do?',
  openai_option_reuse: 'Reuse the existing key from Secret Manager',
  openai_option_replace: 'Replace with a new key',
  openai_option_skip: 'Skip (I will inject the key manually)',
  openai_saved_to_secret_manager: 'OpenAI API key saved to GCP Secret Manager',
  openai_keep_trying_prompt: 'That was 5 invalid attempts. Keep trying?',
  openai_skipped_warning: 'OpenAI API key NOT set. The watcher will not be able to embed notes until you set it manually.',

  // Resume installer
  resume_found_title: 'A previous installation was found',
  resume_found_subtitle: 'You can continue where it stopped, pick a specific step, or start over.',
  resume_last_completed: 'Last completed step',
  resume_failed_at: 'Failed at step',
  resume_saved_at: 'Saved',
  resume_prompt: 'How do you want to proceed?',
  resume_option_continue: 'Continue from where it stopped',
  resume_option_pick_step: 'Pick a specific step to restart from',
  resume_option_restart: 'Start a fresh installation (discard saved state)',
  resume_pick_step_prompt: 'Select the step to restart from:',
  resume_starting_from: 'Resuming from step',
  resume_cleared: 'Previous installer state discarded.',

  // Error reporting
  error_report_prompt: 'Would you like to report this issue on GitHub?',
  error_report_creating: 'Creating issue report...',
  error_report_created: 'Issue created:',
  error_report_failed: 'Could not create issue report',
  error_report_note: 'Personal data has been redacted from the report',
};
