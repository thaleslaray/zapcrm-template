import { and, asc, eq, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { user } from '#/db/auth-schema'
import {
  avisosPendentes,
  numeros,
  pessoas,
  recibosPendentes,
  servidorUazapi,
} from '#/db/schema'
import { audit } from './audit'
import {
  chamarAdministracao,
  cifrarToken,
  decifrarToken,
  UazapiErro,
} from './uazapi'
import { consolidarAvisoLocal } from './wa-avisos'

type Banco = ReturnType<typeof getDb>
type Segredos = {
  UAZAPI_URL?: string
  UAZAPI_ADMIN_TOKEN?: string
  UAZAPI_CHAVE: string
}
export class ErroServidor extends Error {}

function enderecoInvalido(): never {
  throw new ErroServidor(
    'Endereço do servidor inválido. Informe uma origem HTTPS pública.',
  )
}

function ipv4Reservado(host: string) {
  const [a, b] = host.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

function temControle(texto: string) {
  return Array.from(texto).some(
    (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
  )
}

export function normalizarEndereco(
  valor: string,
  desenvolvimento = import.meta.env.DEV,
) {
  if (
    typeof valor !== 'string' ||
    valor.length > 2048 ||
    !/^https?:\/\//i.test(valor.trim()) ||
    valor.includes('\\') ||
    temControle(valor) ||
    /^https?:\/\/[^/?#]*@/i.test(valor.trim())
  )
    enderecoInvalido()
  let url: URL
  try {
    url = new URL(valor.trim())
  } catch {
    return enderecoInvalido()
  }
  if (url.username || url.password) enderecoInvalido()
  // URL já converte IPv4 decimal/hexadecimal e comprime IPv6 antes desta decisão.
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  url.hostname = host
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (local && desenvolvimento) return url.origin
  if (url.protocol !== 'https:' || local || host.endsWith('.localhost'))
    enderecoInvalido()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && ipv4Reservado(host))
    enderecoInvalido()
  // Em IPv6 aceitamos literais unicast globais. Isto exclui também endereços
  // mapeados em IPv4, de enlace, de loopback e locais únicos.
  if (host.startsWith('[') && !/^\[[23][0-9a-f]{3}:/.test(host))
    enderecoInvalido()
  return url.origin
}

function segredosLegados(env: Segredos) {
  if (!env.UAZAPI_URL || !env.UAZAPI_ADMIN_TOKEN) return null
  try {
    return {
      endereco: normalizarEndereco(env.UAZAPI_URL),
      token: env.UAZAPI_ADMIN_TOKEN,
    }
  } catch {
    return null
  }
}

export async function obterServidor(db: Banco, env: Segredos) {
  const [linha] = await db
    .select({
      endereco: servidorUazapi.endereco,
      cifra: servidorUazapi.tokenCifrado,
    })
    .from(servidorUazapi)
    .where(eq(servidorUazapi.id, 1))
  const legado = segredosLegados(env)
  if (linha)
    return {
      endereco: normalizarEndereco(linha.endereco),
      token: await decifrarToken(env.UAZAPI_CHAVE, linha.cifra),
      origemLegada: legado?.endereco ?? null,
    }
  if (legado) return { ...legado, origemLegada: legado.endereco }
  throw new ErroServidor('Servidor uazapi não configurado.')
}

function gestorAtivo(usuarioId: string) {
  return sql`EXISTS (SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
    WHERE p.usuario_id=${usuarioId} AND p.papel='gestor' AND u.deleted_at IS NULL)`
}

export function leituraEstadoServidor(db: Banco, usuarioId: string) {
  return db
    .select({
      endereco: servidorUazapi.endereco,
      salvoEm: servidorUazapi.salvoEm,
      salvoPor: sql<
        string | null
      >`coalesce(nullif(trim(${user.name}), ''), ${user.email})`,
    })
    .from(pessoas)
    .leftJoin(servidorUazapi, eq(servidorUazapi.id, 1))
    .leftJoin(user, eq(user.id, servidorUazapi.salvoPor))
    .where(and(eq(pessoas.usuarioId, usuarioId), gestorAtivo(usuarioId)))
}

export function projetarEstadoServidor(
  env: Segredos,
  linha?: Awaited<ReturnType<typeof leituraEstadoServidor>>[number],
) {
  if (!linha) throw new ErroServidor('Sem acesso às configurações.')
  const endereco = linha.endereco ?? segredosLegados(env)?.endereco ?? null
  return {
    configurado: Boolean(endereco),
    host: endereco ? new URL(endereco).host : null,
    salvoEm: linha.salvoEm?.getTime() ?? null,
    salvoPor: linha.salvoEm ? (linha.salvoPor ?? 'Conta removida') : null,
  }
}

export async function estadoServidor(env: Env, usuarioId: string) {
  const [linha] = await leituraEstadoServidor(
    getDb(env.DB, 'primario'),
    usuarioId,
  )
  return projetarEstadoServidor(env, linha)
}

// O lote roda no primário. A comparação da origem, o papel atual e a presença
// de números valem no instante da escrita, inclusive com duas abas abertas.
async function aplicarConfiguracao(
  env: Env,
  usuarioId: string,
  confirmar: boolean,
  nova?: { endereco: string; cifra: string },
) {
  const db = getDb(env.DB, 'primario')
  const gestor = gestorAtivo(usuarioId)
  const atual = sql`(SELECT endereco FROM servidor_uazapi WHERE id=1)`
  const legado = segredosLegados(env)?.endereco ?? null
  const troca = nova
    ? sql`coalesce(${atual},${legado},'') <> ${nova.endereco}`
    : sql`${atual} IS NOT NULL`
  const precisaConfirmar = nova
    ? sql`${troca} AND EXISTS (SELECT 1 FROM numeros)`
    : troca
  const trocaConfirmada = sql`${gestor} AND ${confirmar ? 1 : 0} AND ${troca}`
  const pendente = sql`conteudo->>'tipo' IN ('mensagens','recibo','chats') AND coalesce(conteudo->>'consolidado',0)=0`
  const filaPronta = sql`NOT EXISTS (SELECT 1 FROM avisos_pendentes WHERE ${pendente})`
  const revogar = sql`${trocaConfirmada} AND ${filaPronta}`
  const permitido = sql`${gestor} AND (${confirmar ? 1 : 0} OR NOT (${precisaConfirmar}))
    AND (NOT (${troca}) OR ${filaPronta})`
  const agora = new Date()
  const escrita = nova
    ? db
        .insert(servidorUazapi)
        .select(
          sql`SELECT 1,${nova.endereco},${nova.cifra},${usuarioId},${agora.getTime()} WHERE ${permitido}`,
        )
        .onConflictDoUpdate({
          target: servidorUazapi.id,
          set: {
            endereco: sql`excluded.endereco`,
            tokenCifrado: sql`excluded.token_cifrado`,
            salvoPor: sql`excluded.salvo_por`,
            salvoEm: sql`excluded.salvo_em`,
          },
        })
        .returning({ id: servidorUazapi.id })
    : db
        .delete(servidorUazapi)
        .where(and(eq(servidorUazapi.id, 1), permitido))
        .returning({ id: servidorUazapi.id })
  // Uma pausa ou repetição antes da troca preserva também a tentativa de
  // baixar a mídia pelo servidor original. A marca elimina trabalho duplicado.
  let consolidadas = 0
  for (;;) {
    const [[controle], tarefas, , , , resultado] = await db.batch([
      db
        .select({ precisa: sql<number>`(${precisaConfirmar})` })
        .from(pessoas)
        .where(and(eq(pessoas.usuarioId, usuarioId), gestor)),
      db
        .select({
          id: avisosPendentes.id,
          numeroId: avisosPendentes.numeroId,
          conteudo: avisosPendentes.conteudo,
          vinculo: numeros.tokenCifrado,
        })
        .from(avisosPendentes)
        .innerJoin(numeros, eq(numeros.id, avisosPendentes.numeroId))
        .where(and(trocaConfirmada, pendente))
        .orderBy(asc(avisosPendentes.criadoEm), asc(avisosPendentes.id))
        .limit(4),
      db.delete(avisosPendentes).where(revogar),
      db.delete(recibosPendentes).where(revogar),
      db
        .update(numeros)
        .set({
          estado: 'desconectado',
          estadoEm: agora,
          tokenCifrado: null,
          servidorOrigem: null,
          instanciaId: null,
          segredoWebhookHash: null,
          historicoPedido: null,
          historicoOrdem: 0,
          sincronizandoHistorico: false,
        })
        .where(revogar),
      escrita,
    ])
    if (!controle) throw new ErroServidor('Sem acesso às configurações.')
    if (controle.precisa && !confirmar) return { confirmacaoNecessaria: true }
    if (tarefas.length) {
      if (consolidadas >= 20)
        throw new ErroServidor(
          'Parte das mensagens pendentes já está no histórico. Repita a operação para concluir a troca do servidor.',
        )
      try {
        for (const tarefa of tarefas) await consolidarAvisoLocal(env.DB, tarefa)
        const marcar = (t: (typeof tarefas)[number]) =>
          db
            .update(avisosPendentes)
            .set({ conteudo: sql`json_set(conteudo,'$.consolidado',1)` })
            .where(
              and(
                eq(avisosPendentes.id, t.id),
                eq(avisosPendentes.conteudo, t.conteudo),
                sql`EXISTS (SELECT 1 FROM numeros WHERE id=${t.numeroId} AND token_cifrado IS ${t.vinculo})`,
                trocaConfirmada,
              ),
            )
        const [primeira, ...resto] = tarefas
        await db.batch([marcar(primeira), ...resto.map(marcar)])
      } catch {
        throw new ErroServidor(
          'Não foi possível concluir o histórico das mensagens pendentes. Repita a operação para concluir a troca do servidor.',
        )
      }
      consolidadas += tarefas.length
      continue
    }
    if (resultado.length)
      await audit({
        action: nova ? 'uazapi.servidor_salvo' : 'uazapi.servidor_removido',
        actorId: usuarioId,
        targetType: 'servidor_uazapi',
        targetId: '1',
      })
    return { confirmacaoNecessaria: false }
  }
}

export async function salvarServidor(
  env: Env,
  usuarioId: string,
  pedido: { endereco: string; token: string; confirmar?: boolean },
) {
  await estadoServidor(env, usuarioId)
  const endereco = normalizarEndereco(pedido.endereco)
  if (
    typeof pedido.token !== 'string' ||
    !pedido.token.trim() ||
    pedido.token.length > 4096 ||
    temControle(pedido.token)
  )
    throw new ErroServidor('Informe o token de administração.')
  try {
    const lista = await chamarAdministracao(
      endereco,
      pedido.token,
      '/instance/all',
    )
    if (!Array.isArray(lista)) throw new UazapiErro(502)
  } catch (erro) {
    if (
      erro instanceof UazapiErro &&
      (erro.status === 401 || erro.status === 403)
    )
      throw new ErroServidor('Token de administração recusado.')
    throw new ErroServidor(
      'Servidor uazapi não respondeu. Confira o endereço e tente novamente.',
    )
  }
  let cifra: string
  try {
    cifra = await cifrarToken(env.UAZAPI_CHAVE, pedido.token)
  } catch {
    throw new ErroServidor(
      'Configure a chave de cifra do WhatsApp nos segredos do Worker.',
    )
  }
  return aplicarConfiguracao(env, usuarioId, pedido.confirmar === true, {
    endereco,
    cifra,
  })
}

export async function removerServidor(
  env: Env,
  usuarioId: string,
  pedido: { confirmar?: boolean },
) {
  return aplicarConfiguracao(env, usuarioId, pedido.confirmar === true)
}
