import { and, eq, isNull, sql } from 'drizzle-orm'
import { funis, numeros } from '#/db/schema'
import {
  type CredencialInstancia,
  chamarAdministracao,
  chamarInstancia,
  cifrarToken,
  decifrarToken,
  hashSegredo,
  objeto,
  segredoDoEndereco,
  UazapiErro,
} from './uazapi'
import { gravarHistorico } from './wa-avisos'
import { lerInstanciaCriada, lerPareamento } from './wa-avisos-formato'
import { gestorDoNumero, listarInstancias } from './wa-numeros'
import { reconciliarNumero } from './wa-numeros-historico'

import { obterServidor } from './wa-servidor'

type Servidor = Awaited<ReturnType<typeof obterServidor>>

function servidorVigente(s: Servidor) {
  return sql`coalesce((SELECT endereco FROM servidor_uazapi WHERE id=1), ${s.origemLegada}) = ${s.endereco}`
}

const vinculoMudou = () =>
  new Error('O vínculo do número mudou. Atualize a lista e tente de novo.')

type Gestao = Awaited<ReturnType<typeof gestorDoNumero>>
export type Destino = { setorId: string; funilId: string }
export type Selecao = Destino & { instanciaId: string }
export type PedidoCriacao = Destino & { id: string; nome: string; dias: number }
const erroEntrada = () =>
  new Error('Confira o número, o setor e o funil escolhidos.')

function validarDias(dias: number) {
  if (!Number.isInteger(dias) || dias < 1 || dias > 365)
    throw new Error('Escolha de 1 a 365 dias de histórico.')
}

async function validarDestino({ db, acesso }: Gestao, destino: Destino) {
  if (
    !acesso.setores.includes(destino.setorId) ||
    !acesso.funis.includes(destino.funilId)
  )
    throw erroEntrada()
  const [funil] = await db
    .select({ id: funis.id })
    .from(funis)
    .where(
      and(eq(funis.id, destino.funilId), eq(funis.setorId, destino.setorId)),
    )
  if (!funil) throw erroEntrada()
}

async function configurarAviso(
  db: Gestao['db'],
  origem: string,
  id: string,
  credencial: CredencialInstancia,
  segredo: string,
) {
  const atualizado = await db
    .update(numeros)
    .set({ segredoWebhookHash: await hashSegredo(segredo) })
    .where(
      and(eq(numeros.id, id), eq(numeros.tokenCifrado, credencial.vinculo)),
    )
    .returning({ id: numeros.id })
  if (!atualizado.length) throw vinculoMudou()
  await chamarInstancia(credencial.endereco, credencial.token, '/webhook', {
    enabled: true,
    url: `${origem}/api/whatsapp/aviso/${encodeURIComponent(id)}/${segredo}`,
    events: ['connection', 'messages', 'messages_update', 'history'],
    excludeMessages: ['isGroupYes'],
    addUrlEvents: false,
    addUrlTypesMessages: false,
  })
}

async function registrar(
  env: Env,
  ges: Gestao,
  servidor: Servidor,
  origem: string,
  i: ReturnType<typeof lerInstanciaCriada>,
  destino: Destino,
  id: string,
  dias: number,
  nova: boolean,
) {
  const { db } = ges
  const cifra = await cifrarToken(env.UAZAPI_CHAVE, i.token)
  if (nova) {
    const atual = await db
      .update(numeros)
      .set({
        instanciaId: i.id,
        tokenCifrado: cifra,
        servidorOrigem: servidor.endereco,
      })
      .where(
        and(
          eq(numeros.id, id),
          isNull(numeros.estadoEm),
          servidorVigente(servidor),
        ),
      )
      .returning({ id: numeros.id })
    if (!atual.length) throw vinculoMudou()
  } else {
    await db.run(sql`INSERT INTO numeros
      (id,nome,telefone,cor,setor_id,funil_padrao_id,instancia_id,token_cifrado,dias_historico,servidor_origem)
      SELECT ${id},${i.nome},${i.telefone},${destino.setorId === 'pos' ? '#2563eb' : '#0f766e'},${destino.setorId},
        ${destino.funilId},${i.id},${cifra},${dias},${servidor.endereco}
      WHERE ${servidorVigente(servidor)} ON CONFLICT DO NOTHING`)
  }
  const [numero] = await db
    .select()
    .from(numeros)
    .where(eq(numeros.instanciaId, i.id))
  if (
    !numero?.tokenCifrado ||
    (numero.servidorOrigem ?? servidor.origemLegada) !== servidor.endereco
  )
    throw vinculoMudou()
  const vinculo = and(
    eq(numeros.id, numero.id),
    eq(numeros.tokenCifrado, numero.tokenCifrado),
  )
  const credencial = {
    endereco: servidor.endereco,
    token: await decifrarToken(env.UAZAPI_CHAVE, numero.tokenCifrado),
    vinculo: numero.tokenCifrado,
  }
  if (numero.estadoEm) return numero.id
  await configurarAviso(
    db,
    origem,
    numero.id,
    credencial,
    await segredoDoEndereco(env.UAZAPI_CHAVE, numero.id),
  )
  if (i.estado === 'conectado') {
    await db
      .update(numeros)
      .set({ sincronizandoHistorico: true })
      .where(vinculo)
    await reconciliarNumero(env, numero.id, credencial)
  }
  await db
    .update(numeros)
    .set({
      estado: i.estado,
      estadoEm: new Date(),
      telefone: i.telefone,
      sincronizandoHistorico: false,
    })
    .where(vinculo)
  return numero.id
}

export async function adicionarNumeros(
  env: Env,
  userId: string,
  origem: string,
  itens: Selecao[],
) {
  if (!Array.isArray(itens) || !itens.length || itens.length > 50)
    throw erroEntrada()
  const ges = await gestorDoNumero(env, userId)
  const servidor = await obterServidor(ges.db, env)
  const instancias = await listarInstancias(servidor)
  for (const item of itens) {
    await validarDestino(ges, item)
    const i = instancias.find((i) => i.id === item.instanciaId)
    if (!i) throw erroEntrada()
    await registrar(
      env,
      ges,
      servidor,
      origem,
      i,
      item,
      crypto.randomUUID(),
      90,
      false,
    )
  }
}

export async function criarNumero(
  env: Env,
  userId: string,
  origem: string,
  pedido: PedidoCriacao,
) {
  if (
    typeof pedido.nome !== 'string' ||
    !pedido.nome.trim() ||
    pedido.nome.length > 100 ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(pedido.id)
  )
    throw erroEntrada()
  validarDias(pedido.dias)
  const ges = await gestorDoNumero(env, userId)
  const [servidor] = await Promise.all([
    obterServidor(ges.db, env),
    validarDestino(ges, pedido),
  ])
  // A linha reivindica a ação antes da chamada externa. Se a resposta se perder,
  // o identificador administrativo permite recuperar a instância sem criar outra.
  const reserva = await ges.db.run(sql`INSERT INTO numeros
    (id,nome,cor,setor_id,funil_padrao_id,dias_historico,servidor_origem)
    SELECT ${pedido.id},${pedido.nome.trim()},${pedido.setorId === 'pos' ? '#2563eb' : '#0f766e'},
      ${pedido.setorId},${pedido.funilId},${pedido.dias},${servidor.endereco}
    WHERE ${servidorVigente(servidor)} ON CONFLICT DO NOTHING`)
  let i: ReturnType<typeof lerInstanciaCriada>
  if (reserva.meta.changes) {
    try {
      const resposta = await chamarAdministracao(
        servidor.endereco,
        servidor.token,
        '/instance/create',
        {
          name: pedido.nome.trim(),
          adminField01: pedido.id,
        },
      )
      i = lerInstanciaCriada(resposta)
    } catch (erro) {
      if (erro instanceof UazapiErro && erro.status >= 400 && erro.status < 500)
        await ges.db
          .delete(numeros)
          .where(
            and(
              eq(numeros.id, pedido.id),
              isNull(numeros.estadoEm),
              isNull(numeros.instanciaId),
              eq(numeros.servidorOrigem, servidor.endereco),
            ),
          )
      throw erro
    }
  } else {
    const [local] = await ges.db
      .select()
      .from(numeros)
      .where(eq(numeros.id, pedido.id))
    if (local?.estadoEm) return local.id
    const remoto = (await listarInstancias(servidor)).find(
      (i) =>
        i.operacao === pedido.id ||
        (local?.instanciaId && i.id === local.instanciaId),
    )
    if (!remoto)
      throw new Error(
        'A criação ainda não foi confirmada. Consulte novamente em instantes.',
      )
    i = remoto
  }
  return registrar(
    env,
    ges,
    servidor,
    origem,
    i,
    pedido,
    pedido.id,
    pedido.dias,
    true,
  )
}

async function numeroDoGestor(
  env: Env,
  userId: string,
  id: string,
  instanciaId?: string,
) {
  const { db, acesso } = await gestorDoNumero(env, userId)
  if (!acesso.numeros.includes(id)) throw new Error('Sem acesso a este número.')
  const [servidor, linhas] = await Promise.all([
    obterServidor(db, env),
    db.select().from(numeros).where(eq(numeros.id, id)),
  ])
  let numero = linhas[0]
  if (!numero?.estadoEm)
    throw new Error('Conclua a adição do número antes de conectar.')
  if (!numero.tokenCifrado && instanciaId) {
    const instancia = (await listarInstancias(servidor)).find(
      (i) => i.id === instanciaId,
    )
    if (!instancia) throw erroEntrada()
    // A unicidade de instancia_id reserva a instância antes de mudar seu webhook.
    const [ligado] = await db
      .update(numeros)
      .set({
        instanciaId,
        tokenCifrado: await cifrarToken(env.UAZAPI_CHAVE, instancia.token),
        servidorOrigem: servidor.endereco,
        segredoWebhookHash: null,
      })
      .where(
        and(
          eq(numeros.id, id),
          isNull(numeros.tokenCifrado),
          servidorVigente(servidor),
        ),
      )
      .returning()
    if (!ligado) throw vinculoMudou()
    numero = ligado
  }
  if (
    !numero.tokenCifrado ||
    !numero.estadoEm ||
    (numero.servidorOrigem ?? servidor.origemLegada) !== servidor.endereco
  )
    throw new Error('Escolha uma instância para religar este número.')
  if (instanciaId && numero.instanciaId !== instanciaId) throw vinculoMudou()
  return {
    db,
    numero: { ...numero, estadoEm: numero.estadoEm },
    credencial: {
      endereco: servidor.endereco,
      token: await decifrarToken(env.UAZAPI_CHAVE, numero.tokenCifrado),
      vinculo: numero.tokenCifrado,
    },
  }
}

export async function sincronizarConversas(
  env: Env,
  userId: string,
  id: string,
) {
  const { numero, credencial } = await numeroDoGestor(env, userId, id)
  if (numero.estado !== 'conectado')
    throw new Error('Conecte o número antes de sincronizar as conversas.')
  // Um clique avança vários passos da varredura (cada passo traz uma página de
  // conversas e uma de mensagens), para o gestor não precisar repetir dezenas de vezes.
  let resultado = await reconciliarNumero(env, numero.id, credencial)
  for (let passo = 1; passo < 12 && resultado.pendente; passo++)
    resultado = await reconciliarNumero(env, numero.id, credencial)
  // A varredura geral da instância mistura grupos e alcança poucas conversas
  // individuais. As conversas com atividade mais recente são relidas uma a uma,
  // o que traz botões, edições e mensagens que ficaram de fora.
  const recentes = await env.DB.prepare(
    `SELECT jid FROM conversas WHERE numero_id=? AND jid IS NOT NULL
      ORDER BY max(coalesce(ultima_mensagem_em,0),coalesce(previa_em,0)) DESC LIMIT 40`,
  )
    .bind(numero.id)
    .all<{ jid: string }>()
  let mensagens = resultado.mensagens
  for (const { jid } of recentes.results) {
    try {
      const pagina = objeto(
        await chamarInstancia(
          credencial.endereco,
          credencial.token,
          '/message/find',
          { chatid: jid, limit: 20, offset: 0 },
        ),
      )
      if (Array.isArray(pagina.messages))
        mensagens += await gravarHistorico(
          env,
          numero.id,
          credencial,
          pagina.messages.slice(0, 20).filter((m) => objeto(m).chatid === jid),
        )
    } catch {
      // Uma conversa que falha não interrompe as outras; o próximo clique tenta de novo.
    }
  }
  return { ...resultado, mensagens }
}

async function observarEstado(
  env: Env,
  dados: Awaited<ReturnType<typeof numeroDoGestor>>,
  estado: ReturnType<typeof lerPareamento>,
) {
  const { db, numero, credencial } = dados
  if (
    estado.estado === numero.estado &&
    (!estado.telefone || estado.telefone === numero.telefone)
  )
    return
  const mudou = await db
    .update(numeros)
    .set({
      estado: estado.estado,
      estadoEm: new Date(),
      telefone: estado.telefone ?? numero.telefone,
      ...(estado.estado === 'desconectado'
        ? { sincronizandoHistorico: false }
        : {}),
    })
    .where(
      and(
        eq(numeros.id, numero.id),
        eq(numeros.estadoEm, numero.estadoEm),
        eq(numeros.tokenCifrado, credencial.vinculo),
      ),
    )
    .returning({ id: numeros.id })
  if (
    mudou.length &&
    estado.estado === 'conectado' &&
    numero.estado !== 'conectado'
  )
    await reconciliarNumero(env, numero.id, credencial)
}
export async function consultarPareamento(
  env: Env,
  userId: string,
  id: string,
) {
  const dados = await numeroDoGestor(env, userId, id)
  const p = lerPareamento(
    await chamarInstancia(
      dados.credencial.endereco,
      dados.credencial.token,
      '/instance/status',
    ),
  )
  await observarEstado(env, dados, p)
  return p
}
export async function conectarNumero(
  env: Env,
  userId: string,
  pedido: { id: string; dias: number; telefone?: string; instanciaId?: string },
  origem: string,
) {
  validarDias(pedido.dias)
  if (pedido.telefone !== undefined && !/^\d{10,15}$/.test(pedido.telefone))
    throw new Error('Informe o telefone com DDI e DDD.')
  const dados = await numeroDoGestor(env, userId, pedido.id, pedido.instanciaId)
  const { db, credencial, numero } = dados
  const atual = lerPareamento(
    await chamarInstancia(
      credencial.endereco,
      credencial.token,
      '/instance/status',
    ),
  )
  if (
    atual.estado === 'desconectado' ||
    !numero.segredoWebhookHash ||
    (numero.estado === 'desconectado' && atual.estado === 'conectado')
  ) {
    await configurarAviso(
      db,
      origem,
      numero.id,
      credencial,
      // Duas abas reconectando a mesma queda configuram o mesmo endereço.
      // A próxima desconexão terá outra versão de estado e outro segredo.
      await segredoDoEndereco(
        env.UAZAPI_CHAVE,
        numero.id,
        String(numero.estadoEm.getTime()),
      ),
    )
  }
  // A resposta do connect pode se perder depois do pareamento começar. A
  // consulta devolve o QR/código atual e evita iniciar outra tentativa.
  if (
    atual.estado === 'conectado' ||
    (atual.estado === 'conectando' &&
      (pedido.telefone ? atual.codigo : atual.qr))
  ) {
    await observarEstado(env, dados, atual)
    return atual
  }
  let resposta: unknown
  const inicio = new Date()
  try {
    resposta = await chamarInstancia(
      credencial.endereco,
      credencial.token,
      '/instance/connect',
      { history_days: pedido.dias, phone: pedido.telefone },
    )
  } catch (erro) {
    if (!(erro instanceof UazapiErro) || erro.status !== 409) throw erro
    resposta = await chamarInstancia(
      credencial.endereco,
      credencial.token,
      '/instance/status',
    )
  }
  const p = lerPareamento(resposta),
    requestId = objeto(resposta).request_id
  const atualizado = await db
    .update(numeros)
    .set({
      estado: p.estado,
      estadoEm: inicio,
      diasHistorico: pedido.dias,
      telefone: p.telefone ?? numero.telefone,
      ...(typeof requestId === 'string' && requestId !== numero.historicoPedido
        ? {
            historicoPedido: requestId,
            historicoOrdem: 0,
            sincronizandoHistorico: true,
          }
        : {}),
    })
    .where(
      and(
        eq(numeros.id, numero.id),
        eq(numeros.estadoEm, numero.estadoEm),
        eq(numeros.tokenCifrado, credencial.vinculo),
      ),
    )
  if (
    atualizado.meta.changes &&
    p.estado === 'conectado' &&
    numero.estado !== 'conectado'
  )
    await reconciliarNumero(env, numero.id, credencial)
  return p
}
export async function desconectarNumero(env: Env, userId: string, id: string) {
  const { db, numero, credencial } = await numeroDoGestor(env, userId, id)
  const atual = lerPareamento(
    await chamarInstancia(
      credencial.endereco,
      credencial.token,
      '/instance/status',
    ),
  )
  if (atual.estado !== 'desconectado') {
    const autorizado = await numeroDoGestor(env, userId, id)
    if (autorizado.credencial.vinculo !== credencial.vinculo)
      throw vinculoMudou()
    await chamarInstancia(
      autorizado.credencial.endereco,
      autorizado.credencial.token,
      '/instance/disconnect',
      {},
    )
  }
  if (numero.estado === 'desconectado' && atual.estado === 'desconectado')
    return
  await db
    .update(numeros)
    .set({
      estado: 'desconectado',
      estadoEm: new Date(),
      sincronizandoHistorico: false,
    })
    .where(
      and(eq(numeros.id, id), eq(numeros.tokenCifrado, credencial.vinculo)),
    )
}
