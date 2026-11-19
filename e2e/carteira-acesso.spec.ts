import { expect, test } from '@playwright/test'
import {
  emailGestora,
  executarSqlE2E,
  loginWithCode,
  waitForHydration,
} from './helpers'

const emailVendedora = 'qa-j2-acesso@exemplo.test'
const nomeVendedora = 'Rita do Comercial'
const nomeContato = 'Oficina da Serra J2'
const numeroComercial = 'j2-acesso-com'
const negocioVendas = 'j2-acesso-venda'
const contatoId = 'j2-acesso-cliente'
const conversaPos = 'j2-acesso-suporte'
const painelDoContato = `/app/conversas?contato=${contatoId}&funil=vendas&painel=true`

function prepararCarteira() {
  // A mesma pessoa entra a cada execução. Recomeçamos somente a carteira desta prova.
  executarSqlE2E(
    `UPDATE user SET name='${nomeVendedora}' WHERE email='${emailVendedora}';
    INSERT OR IGNORE INTO pessoas_setores(usuario_id,setor_id) SELECT id,'com' FROM user WHERE email='${emailVendedora}';
    INSERT OR IGNORE INTO numeros(id,nome,cor,setor_id,funil_padrao_id) VALUES
      ('${numeroComercial}','Comercial da oficina','#0f766e','com','vendas'),
      ('j2-acesso-extra','Segunda linha da oficina','#0f766e','com','vendas'),
      ('j2-acesso-pos','Suporte da oficina','#2563eb','pos','pos');
    DELETE FROM contatos WHERE id='${contatoId}';
    INSERT INTO contatos(id,nome) VALUES ('${contatoId}','${nomeContato}');
    INSERT INTO conversas(id,numero_id,contato_id) VALUES
      ('j2-acesso-atendimento','${numeroComercial}','${contatoId}'),
      ('${conversaPos}','j2-acesso-pos','${contatoId}');
    INSERT INTO negocios(id,contato_id,funil_id,etapa_id,numero_id,responsavel_id,valor_centavos)
      SELECT '${negocioVendas}','${contatoId}','vendas','novo','${numeroComercial}',id,147500 FROM user WHERE email='${emailGestora}';`,
  )
}

test('J2 · H17a, H17c–17d, H21, H23–25, H28 · setor, transferência de responsável e atalho do ganho', async ({
  page: gestora,
  browser,
  baseURL,
}) => {
  const contexto = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  try {
    const vendedora = await contexto.newPage()
    await vendedora.goto('/login')
    await loginWithCode(vendedora, emailVendedora)
    await expect(vendedora).toHaveURL(/\/app\/conversas$/)
    prepararCarteira()

    await gestora.goto(painelDoContato)
    const trocar = gestora.getByRole('button', { name: 'Trocar', exact: true })
    await waitForHydration(trocar)
    await trocar.click()
    await gestora
      .getByRole('menuitem', { name: nomeVendedora, exact: true })
      .click()
    await expect(
      gestora.getByText(nomeVendedora, { exact: true }),
    ).toBeVisible()
    await gestora.goto('/app/funil?funil=vendas')
    const filtrar = gestora.getByRole('combobox', { name: 'Responsável' })
    await waitForHydration(filtrar)
    await filtrar.selectOption({ label: nomeVendedora })
    const cartao = gestora.getByRole('article').filter({ hasText: nomeContato })
    await expect(cartao).toContainText('Rita')
    const numero = gestora.getByRole('combobox', { name: 'Número da empresa' })
    await numero.selectOption('j2-acesso-extra')
    await expect(cartao).toHaveCount(0)
    await numero.selectOption(numeroComercial)
    await expect(cartao).toHaveCount(1)

    await vendedora.goto('/app/funil?funil=vendas')
    const vendas = vendedora.getByRole('tab', { name: 'Vendas', exact: true })
    await waitForHydration(vendas)
    await expect(vendedora.getByRole('tab', { name: 'Pós-venda' })).toHaveCount(
      0,
    )
    const cartaoVendedora = vendedora
      .getByRole('article')
      .filter({ hasText: nomeContato })
    await cartaoVendedora.dragTo(
      vendedora.getByRole('region', { name: 'Ganho', exact: true }),
    )
    await vendedora.getByRole('link', { name: 'Ver', exact: true }).click()
    const painel = vendedora.getByRole('complementary', {
      name: 'Painel do contato',
    })
    await expect(
      painel.getByRole('heading', { name: nomeContato }),
    ).toBeVisible()
    await expect(painel).toContainText('Instalação agendada')
    await expect(
      painel.getByRole('button', { name: 'Apagar contato' }),
    ).toHaveCount(0)
    await expect(painel.getByRole('button', { name: 'Trocar' })).toHaveCount(0)
    const novoNegocio = painel.getByRole('button', { name: 'Novo negócio' })
    await waitForHydration(novoNegocio)
    await novoNegocio.click()
    await expect(
      vendedora.getByRole('menuitem', { name: 'Vendas', exact: true }),
    ).toBeVisible()
    await expect(
      vendedora.getByRole('menuitem', { name: 'Pós-venda' }),
    ).toHaveCount(0)

    for (const url of [
      '/app/funil?funil=pos',
      `/app/conversas?conversa=${conversaPos}`,
    ]) {
      await vendedora.goto(url)
      await expect(
        vendedora.getByRole('heading', { name: 'Sem acesso' }),
      ).toBeVisible()
      await expect(vendedora.getByRole('article')).toHaveCount(0)
    }
    await gestora.goto('/app/funil?funil=pos')
    const origem = gestora.getByRole('article').filter({ hasText: nomeContato })
    await expect(origem).toContainText('Rita')
    await expect(origem).not.toContainText('1.475')

    // O mesmo comando válido no Pós-venda é autorizado pela sessão de quem chama.
    const pedidoDaGestora = gestora.waitForRequest(
      (req) =>
        req.method() === 'POST' && !!req.postData()?.includes('moverNegocio'),
    )
    const instalado = gestora.getByRole('region', {
      name: 'Instalado',
      exact: true,
    })
    await origem.dragTo(instalado)
    const pedido = await pedidoDaGestora
    await expect(
      instalado.getByRole('article').filter({ hasText: nomeContato }),
    ).toBeVisible()
    const respostaVendedora = await vendedora.request.post(pedido.url(), {
      headers: {
        'content-type': pedido.headers()['content-type'],
        'x-tsr-serverfn': 'true',
        origin: new URL(pedido.url()).origin,
      },
      data: pedido.postData() ?? '',
    })
    expect(await respostaVendedora.text()).toContain('Sem acesso.')
  } finally {
    await contexto.close()
    executarSqlE2E(`
      DELETE FROM contatos WHERE id='${contatoId}';
      DELETE FROM numeros WHERE id IN ('${numeroComercial}','j2-acesso-extra','j2-acesso-pos');`)
  }
})
