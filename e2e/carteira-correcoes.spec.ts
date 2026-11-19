import { expect, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'

test('o histórico identifica o resultado de uma etapa de nome livre', async ({
  page,
}) => {
  executarSqlE2E(`
    INSERT INTO funis(id,nome,cor,setor_id) VALUES ('c1-hist','Parceiros','#0f766e','com');
    INSERT INTO etapas(id,nome,cor,funil_id,posicao,fechamento) VALUES ('c1-assinatura','Assinatura','#0f766e','c1-hist',1,'sucesso');
    INSERT INTO contatos(id,nome) VALUES ('c1-hist','Cliente do histórico');
    INSERT INTO negocios(id,contato_id,funil_id,etapa_id,fechado_em) VALUES ('c1-hist','c1-hist','c1-hist','c1-assinatura',1234567890000);
  `)
  try {
    await page.goto('/app/conversas?contato=c1-hist&funil=c1-hist&painel=true')
    const historico = page.getByRole('button', {
      name: /Histórico de negócios/,
    })
    await waitForHydration(historico)
    await historico.click()
    const linha = page.getByRole('listitem').filter({ hasText: 'Assinatura' })
    await expect(linha).toContainText('Ganho')
  } finally {
    executarSqlE2E(
      "DELETE FROM contatos WHERE id='c1-hist'; DELETE FROM etapas WHERE id='c1-assinatura'; DELETE FROM funis WHERE id='c1-hist'",
    )
  }
})

test('o quadro soma o valor próprio de um negócio manual no Pós-venda', async ({
  page,
}) => {
  executarSqlE2E(`
    INSERT INTO numeros(id,nome,cor,setor_id,funil_padrao_id) VALUES ('c1-pos','Número manual','#0f766e','pos','pos');
    INSERT INTO contatos(id,nome) VALUES ('c1-pos','Cliente da manutenção');
    INSERT INTO negocios(id,contato_id,funil_id,etapa_id,numero_id,valor_centavos) VALUES ('c1-pos','c1-pos','pos','agendada','c1-pos',12345);
  `)
  try {
    await page.goto('/app/funil?funil=pos')
    const filtro = page.getByRole('combobox', {
      name: 'Número da empresa',
      exact: true,
    })
    await waitForHydration(filtro)
    await filtro.selectOption('c1-pos')
    await expect(page.locator('.page-head .sum')).toContainText('123,45')
    await expect(
      page
        .getByRole('region', { name: 'Instalação agendada', exact: true })
        .locator('.tot'),
    ).toContainText('123,45')
  } finally {
    executarSqlE2E(
      "DELETE FROM contatos WHERE id='c1-pos'; DELETE FROM numeros WHERE id='c1-pos'",
    )
  }
})

test('o cartão sem conversa no setor abre o painel sem exibir o chat comercial', async ({
  page,
}) => {
  executarSqlE2E(`
    INSERT INTO numeros(id,nome,cor,setor_id,funil_padrao_id,estado_em) VALUES ('c1-atend','Comercial','#0f766e','com','vendas',1234567890000);
    INSERT INTO contatos(id,nome) VALUES ('c1-cartao','Cliente do cartão');
    INSERT INTO conversas(id,contato_id,numero_id) VALUES ('c1-atend','c1-cartao','c1-atend');
    INSERT INTO negocios(id,contato_id,funil_id,etapa_id) VALUES ('c1-cartao','c1-cartao','pos','agendada');
  `)
  try {
    await page.goto('/app/funil?funil=pos')
    const link = page.getByRole('link', {
      name: 'Abrir painel de Cliente do cartão',
    })
    await waitForHydration(link)
    await link.click()
    await expect(
      page.getByRole('complementary', { name: 'Painel do contato' }),
    ).toContainText('Cliente do cartão')
    await expect(page.locator('.chat-col .welcome')).toBeVisible()
  } finally {
    executarSqlE2E(
      "DELETE FROM contatos WHERE id='c1-cartao'; DELETE FROM numeros WHERE id='c1-atend'",
    )
  }
})
