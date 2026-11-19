// Identidade da instalação. O domínio é verificado para envio no Cloudflare Email Service.
export const appConfig = {
  name: 'ZapCRM',
  description: 'Conversas, negócios e retornos da sua equipe de vendas.',
  url: 'https://zapcrm.example',
  supportEmail: 'suporte@zapcrm.example',
  accessMode: 'allowlist' as 'open' | 'allowlist',
}
