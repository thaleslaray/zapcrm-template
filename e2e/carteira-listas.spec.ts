import { expect, test } from '@playwright/test'
import { executarSqlE2E, waitForHydration } from './helpers'

// Este funil tem duas oportunidades, com ordenações opostas de data e valor.
// Os identificadores próprios mantêm a simulação independente da J2 principal.
function preparar() {
  executarSqlE2E(`
    INSERT OR IGNORE INTO funis (id, setor_id, nome, cor)
      VALUES ('j2-lista-f','com','Carteira de instalações','#0f766e');
    INSERT OR IGNORE INTO etapas (id,funil_id,nome,cor,posicao) VALUES
      ('j2-lista-e1','j2-lista-f','Análise da carteira','#2563eb',1),
      ('j2-lista-e2','j2-lista-f','Visita da carteira','#d97706',2);
    INSERT OR IGNORE INTO numeros (id,nome,cor,setor_id,funil_padrao_id) VALUES
      ('j2-lista-n1','Filial Norte','#0f766e','com','j2-lista-f'),
      ('j2-lista-n2','Filial Sul','#0f766e','com','j2-lista-f');
    INSERT OR IGNORE INTO user (id,name,email) VALUES
      ('j2-lista-p','Elisa da Carteira','qa-elisa-listas@exemplo.test');
    INSERT OR IGNORE INTO pessoas (usuario_id,papel) VALUES ('j2-lista-p','vendedor');
    INSERT OR IGNORE INTO pessoas_setores (usuario_id,setor_id) VALUES ('j2-lista-p','com');
    INSERT OR IGNORE INTO contatos (id,nome,empresa) VALUES
      ('j2-lista-c1','Ana da Carteira','Oficina das Araucárias'),
      ('j2-lista-c2','Beto da Carteira','Oficina dos Pinheiros');
    INSERT OR IGNORE INTO conversas (id,contato_id,numero_id,ultima_mensagem_em) VALUES
      ('j2-lista-v1','j2-lista-c1','j2-lista-n1',1750010000000),
      ('j2-lista-v2','j2-lista-c2','j2-lista-n2',1750020000000);
    INSERT OR IGNORE INTO negocios (id,contato_id,funil_id,etapa_id,numero_id,responsavel_id,valor_centavos) VALUES
      ('j2-lista-d1','j2-lista-c1','j2-lista-f','j2-lista-e1','j2-lista-n1','j2-lista-p',150000),
      ('j2-lista-d2','j2-lista-c2','j2-lista-f','j2-lista-e2','j2-lista-n2',NULL,30000);
    INSERT OR IGNORE INTO etiquetas (id,nome,cor) VALUES ('j2-lista-tag','Visita da semana','#16a34a');
    INSERT OR IGNORE INTO contatos_etiquetas (contato_id,etiqueta_id) VALUES ('j2-lista-c2','j2-lista-tag');
  `)
}

function limpar() {
  executarSqlE2E(`
    DELETE FROM contatos WHERE id IN ('j2-lista-c1','j2-lista-c2');
    DELETE FROM etiquetas WHERE id='j2-lista-tag';
    DELETE FROM numeros WHERE id IN ('j2-lista-n1','j2-lista-n2');
    DELETE FROM funis WHERE id='j2-lista-f';
    DELETE FROM user WHERE id='j2-lista-p';
  `)
}

test('J2 · H23–24, H28–30 · filtra e ordena a carteira e recupera uma leitura interrompida', async ({
  page,
}) => {
  preparar()
  try {
    await page.goto('/app/contatos')
    const busca = page.getByRole('searchbox', { name: 'Buscar contato' })
    await waitForHydration(busca)
    await busca.fill('da Carteira')
    const tabela = page.getByRole('table')
    const nomes = tabela.getByRole('link')
    await expect(nomes).toHaveText(['Beto da Carteira', 'Ana da Carteira'])
    await tabela.getByRole('button', { name: 'Valor em aberto' }).click()
    await expect(nomes).toHaveText(['Ana da Carteira', 'Beto da Carteira'])
    await tabela.getByRole('button', { name: 'Valor em aberto' }).click()
    await expect(nomes).toHaveText(['Beto da Carteira', 'Ana da Carteira'])
    await tabela.getByRole('button', { name: 'Última conversa' }).click()
    await tabela.getByRole('button', { name: 'Última conversa' }).click()
    await expect(nomes).toHaveText(['Ana da Carteira', 'Beto da Carteira'])

    const etapa = page.getByRole('combobox', { name: 'Etapa', exact: true })
    await etapa.selectOption('j2-lista-e2')
    await expect(nomes).toHaveText(['Beto da Carteira'])
    await etapa.selectOption('')
    const etiqueta = page.getByRole('combobox', {
      name: 'Etiqueta',
      exact: true,
    })
    await etiqueta.selectOption('j2-lista-tag')
    await expect(nomes).toHaveText(['Beto da Carteira'])
    await etiqueta.selectOption('')
    const pessoa = page.getByRole('combobox', {
      name: 'Responsável',
      exact: true,
    })
    await pessoa.selectOption('j2-lista-p')
    await expect(nomes).toHaveText(['Ana da Carteira'])
    await busca.fill('nenhuma oficina com esse nome')
    await expect(
      page.getByText('Nada encontrado para “nenhuma oficina com esse nome”'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Limpar busca' }).click()
    await expect(busca).toHaveValue('')
    await expect(pessoa).toHaveValue('')
    await expect(
      tabela.getByRole('link', { name: 'Beto da Carteira' }),
    ).toBeVisible()

    let interromper = true
    await page.route('**/_serverFn/**', (rota) => {
      if (interromper && rota.request().postData()?.includes('Arauc')) {
        return rota.abort('connectionreset')
      }
      return rota.continue()
    })
    await busca.fill('Araucárias')
    await expect(page.getByRole('alert')).toContainText(
      'Não foi possível carregar',
      { timeout: 20_000 },
    )
    interromper = false
    await page.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(nomes).toHaveText(['Ana da Carteira'])
    await expect(busca).toHaveValue('Araucárias')

    await page.goto('/app/funil?funil=j2-lista-f')
    const numero = page.getByRole('combobox', {
      name: 'Número da empresa',
      exact: true,
    })
    await waitForHydration(numero)
    await expect(page.locator('.sum')).toContainText('1.800')
    await numero.selectOption('j2-lista-n2')
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByRole('article')).toContainText('Beto da Carteira')
    await expect(page.locator('.sum')).toContainText('300')
    await numero.selectOption('')
    await pessoa.selectOption('j2-lista-p')
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByRole('article')).toContainText('Ana da Carteira')
    await expect(
      page.getByRole('region', { name: 'Visita da carteira' }),
    ).toContainText('Nenhum negócio nesta etapa')
  } finally {
    limpar()
  }
})
