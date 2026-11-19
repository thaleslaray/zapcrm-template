import { expect, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'

test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })

test('H21 · abre o primeiro negócio escolhendo o funil e uma pessoa do setor', async ({
  page,
}) => {
  const contatoId = 'h21-abertura'
  executarSqlE2E(`
    INSERT INTO contatos(id,nome) VALUES ('${contatoId}','Cliente sem negócio');
    INSERT INTO user(id,name,email) VALUES
      ('h21-com','Ana do Comercial','qa-h21-com@exemplo.test'),
      ('h21-pos','Rita da Instalação','qa-h21-pos@exemplo.test');
    INSERT INTO pessoas(usuario_id,papel) VALUES ('h21-com','vendedor'),('h21-pos','vendedor');
    INSERT INTO pessoas_setores(usuario_id,setor_id) VALUES ('h21-com','com'),('h21-pos','pos');`)
  try {
    await page.goto(`/app/conversas?contato=${contatoId}&painel=true`)
    const painel = page.getByRole('complementary', {
      name: 'Painel do contato',
    })
    await waitForHydration(
      painel.getByRole('heading', { name: 'Cliente sem negócio' }),
    )
    await painel
      .getByRole('button', { name: 'Novo negócio', exact: true })
      .click()
    const janela = page.getByRole('dialog', { name: 'Novo negócio' })
    await expect(janela).toBeVisible()
    const funil = janela.getByRole('combobox', { name: 'Funil' })
    const responsavel = janela.getByRole('combobox', { name: 'Responsável' })
    await funil.selectOption({ label: 'Vendas' })
    await responsavel.selectOption({ label: 'Ana do Comercial' })
    await funil.selectOption({ label: 'Pós-venda' })
    await expect(
      responsavel.getByRole('option', { name: 'Ana do Comercial' }),
    ).toHaveCount(0)
    await responsavel.selectOption({ label: 'Rita da Instalação' })
    await janela.getByRole('button', { name: 'Abrir negócio' }).click()
    await expect(janela).toHaveCount(0)
    await expect(painel).toContainText('Instalação agendada')
    await page.reload()
    await expect(
      painel.getByText('Rita da Instalação', { exact: true }),
    ).toBeVisible()
    await expect(
      painel.getByRole('button', { name: 'Trocar', exact: true }),
    ).toBeVisible()
  } finally {
    executarSqlE2E(`DELETE FROM contatos WHERE id='${contatoId}';
      DELETE FROM user WHERE id IN ('h21-com','h21-pos');`)
  }
})
