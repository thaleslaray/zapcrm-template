import { expect, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'

const contato = 'c2-recompra'
const nome = 'Oficina da recompra'
const aviso =
  'Este contato tem uma instalação em aberto no Pós-venda. Conclua a instalação anterior antes de ganhar esta venda.'
const urlPainel = `/app/conversas?contato=${contato}&painel=true`

test.beforeEach(() => {
  executarSqlE2E(`
    INSERT INTO contatos(id,nome) VALUES ('${contato}','${nome}');
    INSERT INTO negocios(id,contato_id,funil_id,etapa_id,fechado_em,origem_id) VALUES
      ('c2-venda-anterior','${contato}','vendas','ganho',unixepoch()*1000,NULL),
      ('c2-instalacao','${contato}','pos','agendada',NULL,'c2-venda-anterior'),
      ('c2-ampliacao','${contato}','vendas','novo',NULL,NULL);
  `)
})

test.afterEach(() => {
  executarSqlE2E(`DELETE FROM contatos WHERE id='${contato}'`)
})

test('J2 · H17d · o painel explica a recusa e permite ganhar depois de concluir a instalação', async ({
  page,
}) => {
  await page.goto(`${urlPainel}&funil=vendas`)
  const painel = page.getByRole('complementary', { name: 'Painel do contato' })
  const ganhar = painel.getByRole('button', { name: 'Mover para Ganho' })
  await waitForHydration(ganhar)
  await ganhar.click()
  await expect(painel.getByRole('alert')).toHaveText(aviso)
  await expect(ganhar).toBeEnabled()

  await page.goto(`${urlPainel}&funil=pos`)
  const concluir = painel.getByRole('button', { name: 'Mover para Concluído' })
  await waitForHydration(concluir)
  await concluir.click()
  await expect(
    painel.getByRole('button', { name: /Histórico de negócios/ }),
  ).toContainText('2 negócios fechados')
  await page.goto(`${urlPainel}&funil=vendas`)
  await waitForHydration(ganhar)
  await ganhar.click()
  await expect(page.getByText(/Negócio criado no Pós-venda/)).toBeVisible()
})

for (const caminho of ['arraste', 'menu do celular'] as const) {
  test(`J2 · H17d · ${caminho} mostra a recusa e conserva o cartão em Novo`, async ({
    page,
  }) => {
    if (caminho === 'menu do celular')
      await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app/funil?funil=vendas')
    const origem = page.getByRole('region', { name: 'Novo', exact: true })
    const cartao = origem.getByRole('article').filter({ hasText: nome })
    await waitForHydration(cartao)
    if (caminho === 'arraste') {
      await cartao.dragTo(
        page.getByRole('region', { name: 'Ganho', exact: true }),
      )
    } else {
      await cartao.getByRole('button', { name: 'Mover para…' }).click()
      await page.getByRole('menuitem', { name: 'Ganho', exact: true }).click()
    }
    await expect(page.getByText(aviso, { exact: true })).toBeVisible()
    await expect(cartao).toBeVisible()
    await page.reload()
    await expect(cartao).toBeVisible()
  })
}
