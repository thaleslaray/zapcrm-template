import { expect, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'

test.beforeEach(() => {
  executarSqlE2E(`
    INSERT INTO numeros(id,nome,cor,setor_id,funil_padrao_id,estado,estado_em)
      VALUES ('fila-c1','Linha da fila','#0f766e','com','vendas','conectado',1);
    INSERT INTO contatos(id,nome,telefone) VALUES ('fila-c1','Cliente da fila','+55 (11) 98765-4980');
    INSERT INTO conversas(id,numero_id,contato_id) VALUES ('fila-c1','fila-c1','fila-c1');
  `)
})
test.afterEach(() => {
  executarSqlE2E(
    "DELETE FROM contatos WHERE id='fila-c1'; DELETE FROM numeros WHERE id='fila-c1';",
  )
})

test('H6 · a busca encontra o telefone pelos dígitos', async ({ page }) => {
  await page.goto('/app/conversas')
  const busca = page.getByRole('searchbox', { name: 'Buscar conversa' })
  await waitForHydration(busca)
  await busca.fill('11987654980')
  await expect(
    page.getByRole('button', { name: /Cliente da fila/ }),
  ).toBeVisible()
})

test('seletores e compositor mostram o foco do teclado', async ({ page }) => {
  await page.goto('/app/conversas')
  const contato = page.getByRole('button', { name: /Cliente da fila/ })
  await waitForHydration(contato)
  await contato.click()
  await page.keyboard.press('Tab')
  for (const campo of [
    page.getByLabel('Etiqueta', { exact: true }),
    page.getByRole('textbox', { name: 'Mensagem', exact: true }),
  ]) {
    await campo.focus()
    await expect(campo).toBeFocused()
    await expect(campo).toHaveCSS('outline-style', 'solid')
  }
})

test('H5/H8 · um retorno vence com a fila aberta', async ({ page }) => {
  await page.goto('/app/conversas')
  const linha = page.getByRole('button', { name: /Cliente da fila/ })
  await waitForHydration(linha)
  executarSqlE2E(`INSERT INTO retornos(id,contato_id,numero_id,marcado_para,motivo)
      VALUES ('fila-c1','fila-c1','fila-c1',${Date.now() + 9500},'Telefonar');`)
  await page.reload()
  await waitForHydration(linha)
  await expect(linha).not.toContainText('Atrasado')
  await page.getByRole('tab', { name: 'Retorno atrasado' }).click()
  await expect(linha).not.toBeVisible()
  await expect(linha).toContainText('Atrasado', { timeout: 18500 })
  await expect(
    page
      .getByRole('navigation', { name: 'Área logada' })
      .getByRole('link', { name: 'Retornos' }),
  ).toContainText('1')
})
