import { and, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '#/db'
import { funis, numeros, setores } from '#/db/schema'
import { setoresVisiveis } from './acesso-crm'
import { chamarAdministracao, UazapiErro } from './uazapi'
import { lerInstancia } from './wa-avisos-formato'
import {
  leituraEstadoServidor,
  obterServidor,
  projetarEstadoServidor,
} from './wa-servidor'

export { estadoRemoto, telefoneRemoto } from './wa-avisos-formato'

export async function gestorDoNumero(env: Env, userId: string) {
  const db = getDb(env.DB, 'primario')
  const acesso = await setoresVisiveis(db, userId)
  if (acesso.papel !== 'gestor') throw new Error('Sem acesso às configurações.')
  return { db, acesso }
}

export async function listarInstancias(servidor: {
  endereco: string
  token: string
}) {
  const registros = await chamarAdministracao(
    servidor.endereco,
    servidor.token,
    '/instance/all',
  )
  if (!Array.isArray(registros)) throw new UazapiErro(502)
  return registros.map(lerInstancia).filter((instancia) => instancia !== null)
}

export async function catalogoDoGestor(env: Env, userId: string) {
  const { db, acesso } = await gestorDoNumero(env, userId)
  const [remotos, locais] = await Promise.all([
    obterServidor(db, env).then(listarInstancias),
    db
      .select({ id: numeros.instanciaId, pronto: numeros.estadoEm })
      .from(numeros)
      .where(inArray(numeros.id, acesso.numeros)),
  ])
  const cadastrados = new Set(locais.filter((n) => n.pronto).map((n) => n.id))
  return remotos.map(({ id, nome, estado, telefone }) => ({
    id,
    nome,
    estado,
    telefone,
    adicionada: cadastrados.has(id),
  }))
}

export async function painelDoGestor(env: Env, userId: string) {
  const { db, acesso } = await gestorDoNumero(env, userId)
  const [linhas, setoresDoGestor, funisDoGestor, [estado]] = await db.batch([
    db
      .select({
        id: numeros.id,
        nome: numeros.nome,
        estado: numeros.estado,
        telefone: numeros.telefone,
        setorId: numeros.setorId,
        funilPadraoId: numeros.funilPadraoId,
        diasHistorico: numeros.diasHistorico,
        sincronizando: numeros.sincronizandoHistorico,
        precisaVincular: sql<boolean>`${numeros.tokenCifrado} IS NULL`.mapWith(
          Boolean,
        ),
      })
      .from(numeros)
      .where(
        and(inArray(numeros.id, acesso.numeros), isNotNull(numeros.estadoEm)),
      )
      .orderBy(numeros.nome),
    db
      .select()
      .from(setores)
      .where(inArray(setores.id, acesso.setores))
      .orderBy(setores.nome),
    db
      .select()
      .from(funis)
      .where(inArray(funis.id, acesso.funis))
      .orderBy(funis.nome),
    leituraEstadoServidor(db, userId),
  ])
  return {
    servidor: projetarEstadoServidor(env, estado),
    numeros: linhas,
    setores: setoresDoGestor,
    funis: funisDoGestor,
  }
}
