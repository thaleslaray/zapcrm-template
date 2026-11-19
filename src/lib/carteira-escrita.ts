import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import type { getDb } from '#/db'
import { contatos, conversas, etapas, negocios, numeros } from '#/db/schema'
import { idsDeSetoresVisiveis, setoresVisiveis } from '#/lib/acesso-crm'
import { audit } from '#/lib/audit'
import { limparArquivosExcluidos } from '#/lib/carteira-escrita-arquivos'
import { type ComandoNota, gravarNota } from '#/lib/notas'
import { jidDoTelefone, normalizarTelefone } from '#/lib/telefone'
import { type ComandoRetorno, gravarRetorno } from './retornos-escrita'
import {
  completarMarcasAntesDeApagar,
  identidadesParaExclusao,
} from './wa-mensagens-excluidas'

export type ComandoCarteira =
  | ComandoRetorno
  | ComandoNota
  | {
      tipo: 'criarContato'
      id: string
      nome: string
      telefone: string
      empresa?: string
      numeroId: string
    }
  | {
      tipo: 'editarContato'
      contatoId: string
      nome: string
      telefone: string
      empresa?: string
      negocio?: { id: string; valorCentavos: number | null }
    }
  | {
      tipo: 'abrirNegocio'
      id: string
      contatoId: string
      funilId: string
      responsavelId?: string
      valorCentavos?: number | null
    }
  | { tipo: 'moverNegocio'; negocioId: string; etapaId: string }
  | { tipo: 'trocarResponsavel'; negocioId: string; responsavelId: string }
  | {
      tipo: 'apagarContato'
      contatoId: string
      conversas: number
      negocios: number
    }

type Resultado =
  | {
      ok: true
      contatoId: string
      conversaId?: string
      negocioId?: string
      posVenda?: {
        negocioId: string
        funilId: string
        etapa: string
        podeAbrir: boolean
      }
    }
  | { ok: false; mensagem: string; existenteId?: string }

type Banco = ReturnType<typeof getDb>
type Acesso = Awaited<ReturnType<typeof setoresVisiveis>>
const recusar = (mensagem: string): Resultado => ({ ok: false, mensagem })
const semAcesso = () => recusar('Sem acesso.')
const idValido = (x: unknown) =>
  typeof x === 'string' && x.length > 0 && x.length <= 128
const idNovo = (x: unknown) =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x)
const telefoneDuplicado = (existenteId: string): Resultado => ({
  ok: false,
  mensagem: 'Este telefone já está cadastrado.',
  existenteId,
})

function dadosContato(
  c: Extract<ComandoCarteira, { tipo: 'criarContato' | 'editarContato' }>,
) {
  if (
    typeof c.nome !== 'string' ||
    !c.nome.trim() ||
    c.nome.length > 150 ||
    (c.empresa !== undefined &&
      (typeof c.empresa !== 'string' || c.empresa.length > 180))
  )
    return null
  if (
    typeof c.telefone !== 'string' ||
    c.telefone.length > 32 ||
    !/^\+?[0-9().\s-]+$/.test(c.telefone.trim())
  )
    return null
  const telefone = c.telefone.trim()
  try {
    const telefoneNormalizado = normalizarTelefone(telefone)
    if (!/^\d{7,15}$/.test(telefoneNormalizado)) return null
    return {
      nome: c.nome.trim(),
      empresa: c.empresa?.trim() || null,
      telefone,
      telefoneNormalizado,
    }
  } catch {
    return null
  }
}

async function criarContato(
  db: Banco,
  acesso: Acesso,
  c: Extract<ComandoCarteira, { tipo: 'criarContato' }>,
): Promise<Resultado> {
  if (!acesso.numeros.includes(c.numeroId)) return semAcesso()
  const dados = dadosContato(c)
  if (!idNovo(c.id) || !dados)
    return recusar('Confira o nome, o telefone com DDD e a empresa.')
  const [, , [salvo], [conversa]] = await db.batch([
    db
      .insert(contatos)
      .values({ id: c.id, ...dados })
      .onConflictDoNothing(),
    // Somente o pedido que criou o contato cria sua primeira conversa.
    db.insert(conversas).select(
      sql`SELECT ${crypto.randomUUID()}, ${c.id}, ${c.numeroId}, ${jidDoTelefone(dados.telefone)},
          NULL AS lid, NULL AS nao_lidas_em, 0 AS nao_lidas, NULL AS ultima_mensagem_em,
          NULL AS previa_texto, NULL AS previa_tipo, NULL AS previa_direcao, NULL AS previa_em WHERE changes() = 1`,
    ),
    db
      .select({
        id: contatos.id,
        nome: contatos.nome,
        empresa: contatos.empresa,
      })
      .from(contatos)
      .where(eq(contatos.telefoneNormalizado, dados.telefoneNormalizado)),
    db
      .select({ id: conversas.id })
      .from(conversas)
      .where(
        and(eq(conversas.contatoId, c.id), eq(conversas.numeroId, c.numeroId)),
      ),
  ])
  if (!salvo) return recusar('Atualize o formulário e tente de novo.')
  return salvo.id === c.id &&
    conversa &&
    salvo.nome === dados.nome &&
    salvo.empresa === dados.empresa
    ? { ok: true, contatoId: salvo.id, conversaId: conversa.id }
    : telefoneDuplicado(salvo.id)
}

function valorValido(x: unknown) {
  return (
    x == null || (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0)
  )
}

async function abrirNegocio(
  db: Banco,
  acesso: Acesso,
  usuarioId: string,
  c: Extract<ComandoCarteira, { tipo: 'abrirNegocio' }>,
): Promise<Resultado> {
  const responsavelId =
    c.responsavelId === undefined ? usuarioId : c.responsavelId
  if (
    !acesso.funis.includes(c.funilId) ||
    (acesso.papel !== 'gestor' && responsavelId !== usuarioId)
  )
    return semAcesso()
  if (
    !idValido(responsavelId) ||
    !idNovo(c.id) ||
    !idValido(c.contatoId) ||
    !valorValido(c.valorCentavos)
  )
    return recusar('Confira os dados do negócio.')
  const banco = db.$client
  // A primeira etapa e o número do contato são escolhidos dentro do próprio lote.
  const [, salvos, abertos] = await banco.batch<{ id: string }>([
    banco
      .prepare(`INSERT INTO negocios (id,contato_id,funil_id,etapa_id,responsavel_id,valor_centavos,numero_id)
      SELECT ?1, c.id, f.id, e.id, ?2, ?3, (
        SELECT n.id FROM conversas cv JOIN numeros n ON n.id=cv.numero_id
        WHERE cv.contato_id=c.id AND n.setor_id=f.setor_id
        ORDER BY cv.ultima_mensagem_em DESC, cv.id LIMIT 1
      ) FROM contatos c JOIN funis f ON f.id=?4 JOIN etapas e ON e.funil_id=f.id
      JOIN pessoas autor ON autor.usuario_id=?6 AND (autor.papel='gestor' OR autor.usuario_id=?2)
      JOIN user ua ON ua.id=autor.usuario_id AND ua.deleted_at IS NULL
      JOIN pessoas responsavel ON responsavel.usuario_id=?2
      JOIN user ur ON ur.id=responsavel.usuario_id AND ur.deleted_at IS NULL
      WHERE c.id=?5 AND e.fechamento IS NULL AND (responsavel.papel='gestor' OR EXISTS (
        SELECT 1 FROM pessoas_setores ps WHERE ps.usuario_id=?2 AND ps.setor_id=f.setor_id
      )) ORDER BY e.posicao,e.id LIMIT 1
      ON CONFLICT DO NOTHING`)
      .bind(
        c.id,
        responsavelId,
        c.valorCentavos ?? null,
        c.funilId,
        c.contatoId,
        usuarioId,
      ),
    banco
      .prepare(
        'SELECT id FROM negocios WHERE id=? AND contato_id=? AND funil_id=? AND valor_centavos IS ? AND responsavel_id=?',
      )
      .bind(
        c.id,
        c.contatoId,
        c.funilId,
        c.valorCentavos ?? null,
        responsavelId,
      ),
    banco
      .prepare(
        'SELECT id FROM negocios WHERE contato_id=? AND funil_id=? AND fechado_em IS NULL',
      )
      .bind(c.contatoId, c.funilId),
  ])
  if (salvos.results.length)
    return { ok: true, contatoId: c.contatoId, negocioId: c.id }
  return recusar(
    abertos.results.length
      ? 'Já existe um negócio aberto neste funil.'
      : 'Contato, responsável ou primeira etapa indisponível para este funil.',
  )
}

async function moverNegocio(
  db: Banco,
  acesso: Acesso,
  c: Extract<ComandoCarteira, { tipo: 'moverNegocio' }>,
): Promise<Resultado> {
  if (!idValido(c.negocioId) || !idValido(c.etapaId))
    return recusar('Confira o negócio e a etapa.')
  const [[alvo], [etapa]] = await db.batch([
    db
      .select({ contatoId: negocios.contatoId, funilId: negocios.funilId })
      .from(negocios)
      .where(
        and(
          eq(negocios.id, c.negocioId),
          inArray(negocios.funilId, acesso.funis),
        ),
      ),
    db
      .select({ funilId: etapas.funilId, fechamento: etapas.fechamento })
      .from(etapas)
      .where(
        and(eq(etapas.id, c.etapaId), inArray(etapas.funilId, acesso.funis)),
      ),
  ])
  if (!alvo || !etapa || etapa.funilId !== alvo.funilId) return semAcesso()
  const sucesso = {
    ok: true as const,
    contatoId: alvo.contatoId,
    negocioId: c.negocioId,
  }
  const banco = db.$client
  const mover = banco.prepare(`UPDATE negocios SET etapa_id=?1,
    fechado_em=CASE WHEN (SELECT fechamento FROM etapas WHERE id=?1) IS NULL THEN NULL ELSE ?2 END
    WHERE id=?3 AND funil_id=?4 AND fechado_em IS NULL
    AND EXISTS (SELECT 1 FROM etapas WHERE id=?1 AND funil_id=?4 AND fechamento IS ?5)`)
  const moverParams = [
    c.etapaId,
    Date.now(),
    c.negocioId,
    alvo.funilId,
    etapa.fechamento,
  ]
  const lerEstado = banco
    .prepare('SELECT etapa_id FROM negocios WHERE id=? AND funil_id=?')
    .bind(c.negocioId, alvo.funilId)
  if (alvo.funilId !== 'vendas' || etapa.fechamento !== 'sucesso') {
    const [, estado] = await banco.batch<{ etapa_id: string }>([
      mover.bind(...moverParams),
      lerEstado,
    ])
    return estado.results[0]?.etapa_id === c.etapaId
      ? sucesso
      : recusar('Este negócio já foi fechado.')
  }

  // O fechamento e a criação em outro setor pertencem à mesma transação.
  // A instalação aberta deve ser desta venda ou ter sido aberta manualmente.
  const [, , estado, acompanhamentos] = await banco.batch<{
    id: string
    nome: string
    etapa_id: string
    instalacao_anterior: number
  }>([
    banco
      .prepare(`INSERT INTO negocios (id, contato_id, funil_id, etapa_id, origem_id)
      SELECT ?1, venda.contato_id, e.funil_id, e.id, venda.id
      FROM negocios venda JOIN etapas e ON e.funil_id='pos' AND e.fechamento IS NULL
      WHERE venda.id=?2 AND venda.funil_id='vendas' AND venda.fechado_em IS NULL
      AND EXISTS (SELECT 1 FROM etapas WHERE id=?3 AND funil_id='vendas' AND fechamento='sucesso')
      ORDER BY e.posicao, e.id LIMIT 1 ON CONFLICT DO NOTHING`)
      .bind(crypto.randomUUID(), c.negocioId, c.etapaId),
    banco
      .prepare(`UPDATE negocios SET etapa_id=?1, fechado_em=?2
      WHERE id=?3 AND funil_id='vendas' AND fechado_em IS NULL
      AND EXISTS (SELECT 1 FROM negocios pos WHERE pos.contato_id=negocios.contato_id AND pos.funil_id='pos' AND pos.fechado_em IS NULL
        AND (pos.origem_id=?3 OR pos.origem_id IS NULL))
      AND EXISTS (SELECT 1 FROM etapas WHERE id=?1 AND fechamento='sucesso' AND funil_id='vendas')`)
      .bind(c.etapaId, Date.now(), c.negocioId),
    banco
      .prepare(`SELECT venda.etapa_id, venda.fechado_em IS NULL AND EXISTS (
        SELECT 1 FROM negocios pos WHERE pos.contato_id=venda.contato_id
        AND pos.funil_id='pos' AND pos.fechado_em IS NULL AND pos.origem_id<>venda.id
      ) AS instalacao_anterior FROM negocios venda WHERE venda.id=? AND venda.funil_id='vendas'`)
      .bind(c.negocioId),
    banco
      .prepare(`SELECT n.id, e.nome FROM negocios n JOIN etapas e ON e.id=n.etapa_id
      WHERE n.origem_id=? AND n.funil_id='pos'`)
      .bind(c.negocioId),
  ])
  const pos = acompanhamentos.results[0]
  const venda = estado.results[0]
  if (venda?.etapa_id !== c.etapaId)
    return recusar(
      venda?.instalacao_anterior
        ? 'Este contato tem uma instalação em aberto no Pós-venda. Conclua a instalação anterior antes de ganhar esta venda.'
        : 'Não foi possível ganhar a venda. Confira se o Pós-venda tem uma etapa disponível.',
    )
  if (!pos) return sucesso
  const podeAbrir = acesso.funis.includes('pos')
  return {
    ...sucesso,
    posVenda: {
      negocioId: podeAbrir ? pos.id : '',
      funilId: 'pos',
      etapa: pos.nome,
      podeAbrir,
    },
  }
}

async function editarContato(
  db: Banco,
  acesso: Acesso,
  usuarioId: string,
  c: Extract<ComandoCarteira, { tipo: 'editarContato' }>,
): Promise<Resultado> {
  const dados = dadosContato(c)
  if (!idValido(c.contatoId) || !dados)
    return recusar('Confira o nome, o telefone com DDD e a empresa.')
  if (
    c.negocio !== undefined &&
    (!c.negocio ||
      !idValido(c.negocio.id) ||
      !valorValido(c.negocio.valorCentavos))
  )
    return recusar('Confira o negócio e o valor.')
  const repetido = db
    .select({ id: contatos.id })
    .from(contatos)
    .where(
      and(
        ne(contatos.id, c.contatoId),
        eq(contatos.telefoneNormalizado, dados.telefoneNormalizado),
      ),
    )
  const alvoNegocio =
    c.negocio &&
    and(
      eq(negocios.id, c.negocio.id),
      eq(negocios.contatoId, c.contatoId),
      inArray(negocios.funilId, acesso.funis),
      isNull(negocios.fechadoEm),
      c.negocio.valorCentavos != null ? isNull(negocios.origemId) : undefined,
    )
  const numerosAutorizados = db
    .select({ id: numeros.id })
    .from(numeros)
    .where(inArray(numeros.setorId, idsDeSetoresVisiveis(db, usuarioId)))
  const mudouTelefone = sql`${contatos.telefoneNormalizado} IS NOT ${dados.telefoneNormalizado}`
  const podeEditar = and(
    eq(contatos.id, c.contatoId),
    notExists(repetido),
    or(
      sql`NOT (${mudouTelefone})`,
      notExists(
        db
          .select({ id: conversas.id })
          .from(conversas)
          .where(
            and(
              eq(conversas.contatoId, c.contatoId),
              notInArray(conversas.numeroId, numerosAutorizados),
            ),
          ),
      ),
    ),
    alvoNegocio
      ? exists(db.select({ id: negocios.id }).from(negocios).where(alvoNegocio))
      : undefined,
  )
  // A ficha é compartilhada. Trocar seu telefone só redefine o destinatário
  // quando a pessoa tem acesso atual a todos os números afetados.
  const ajustarConversas = db
    .update(conversas)
    .set({ jid: jidDoTelefone(dados.telefone), lid: null })
    .where(
      and(
        eq(conversas.contatoId, c.contatoId),
        exists(
          db
            .select({ id: contatos.id })
            .from(contatos)
            .where(and(podeEditar, mudouTelefone)),
        ),
      ),
    )
  const salvarContato = db
    .update(contatos)
    .set({ ...dados, nomeEditado: true })
    .where(podeEditar)
  const [, salvo, [duplicado]] = c.negocio
    ? await db.batch([
        ajustarConversas,
        salvarContato,
        repetido,
        db
          .update(negocios)
          .set({ valorCentavos: c.negocio.valorCentavos })
          .where(and(alvoNegocio, sql`changes()=1`)),
      ])
    : await db.batch([ajustarConversas, salvarContato, repetido])
  if (duplicado) return telefoneDuplicado(duplicado.id)
  return salvo.meta.changes ? { ok: true, contatoId: c.contatoId } : semAcesso()
}

async function trocarResponsavel(
  db: Banco,
  acesso: Acesso,
  c: Extract<ComandoCarteira, { tipo: 'trocarResponsavel' }>,
): Promise<Resultado> {
  if (
    acesso.papel !== 'gestor' ||
    !idValido(c.negocioId) ||
    !idValido(c.responsavelId)
  )
    return semAcesso()
  const [salvo] = await db
    .update(negocios)
    .set({ responsavelId: c.responsavelId })
    .where(
      and(
        eq(negocios.id, c.negocioId),
        isNull(negocios.fechadoEm),
        inArray(negocios.funilId, acesso.funis),
        sql`EXISTS (
    SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
      JOIN funis f ON f.id=${negocios.funilId}
      LEFT JOIN pessoas_setores vinculo ON vinculo.usuario_id=p.usuario_id AND vinculo.setor_id=f.setor_id
      WHERE p.usuario_id=${c.responsavelId} AND u.deleted_at IS NULL AND (p.papel='gestor' OR vinculo.setor_id IS NOT NULL)
    )`,
      ),
    )
    .returning({ contatoId: negocios.contatoId })
  return salvo
    ? { ok: true, contatoId: salvo.contatoId, negocioId: c.negocioId }
    : recusar('Escolha uma pessoa que tenha acesso ao setor do negócio aberto.')
}

async function apagarContato(
  db: Banco,
  bucket: Pick<R2Bucket, 'delete'>,
  usuarioId: string,
  c: Extract<ComandoCarteira, { tipo: 'apagarContato' }>,
): Promise<Resultado> {
  if (
    !idValido(c.contatoId) ||
    !Number.isSafeInteger(c.conversas) ||
    c.conversas < 0 ||
    !Number.isSafeInteger(c.negocios) ||
    c.negocios < 0
  )
    return recusar('Confira as quantidades antes de apagar.')
  const banco = db.$client
  await completarMarcasAntesDeApagar(db, c.contatoId)
  const identidades = await identidadesParaExclusao(db, c.contatoId)
  const condicao = `EXISTS (SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
    WHERE u.id=?2 AND p.papel='gestor' AND u.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM acessos_revogados r WHERE r.email=lower(u.email)))
    AND NOT EXISTS (SELECT ct.telefone_normalizado,cv.numero_id,cv.lid FROM contatos ct
      LEFT JOIN conversas cv ON cv.contato_id=ct.id WHERE ct.id=?1
      EXCEPT SELECT value->>'chave',value->>'numero',value->>'lid' FROM json_each(?5))
    AND (SELECT COUNT(*) FROM conversas WHERE contato_id=?1)=?3
    AND (SELECT COUNT(*) FROM negocios WHERE contato_id=?1)=?4
    AND NOT EXISTS (SELECT 1 FROM mensagens m JOIN conversas cv ON cv.id=m.conversa_id
      WHERE cv.contato_id=?1 AND m.identificador IS NOT NULL AND m.marca_reentrega IS NULL)`
  const params = [
    c.contatoId,
    usuarioId,
    c.conversas,
    c.negocios,
    JSON.stringify(identidades),
  ]
  const [, , exclusao, restante] = await banco.batch([
    banco
      .prepare(`INSERT INTO arquivos_em_exclusao (chave,contato_id)
      SELECT DISTINCT m.arquivo_chave,cv.contato_id FROM mensagens m
      JOIN conversas cv ON cv.id=m.conversa_id
      WHERE cv.contato_id=?1 AND m.arquivo_chave IS NOT NULL AND ${condicao}
      AND NOT EXISTS (SELECT 1 FROM mensagens outra JOIN conversas v ON v.id=outra.conversa_id
        WHERE outra.arquivo_chave=m.arquivo_chave AND v.contato_id<>?1)
      UNION ALL SELECT foto_chave,id FROM contatos WHERE id=?1 AND foto_chave IS NOT NULL AND ${condicao}
      ON CONFLICT DO NOTHING`)
      .bind(...params),
    banco
      .prepare(`INSERT OR REPLACE INTO mensagens_excluidas(marca)
      SELECT marca FROM (SELECT value->>'marcaTelefone' AS marca FROM json_each(?5)
        UNION SELECT value->>'marcaLid' FROM json_each(?5))
      WHERE marca IS NOT NULL AND EXISTS (SELECT 1 FROM contatos WHERE id=?1) AND ${condicao}`)
      .bind(...params),
    banco
      .prepare(`DELETE FROM contatos WHERE id=?1 AND ${condicao} RETURNING id`)
      .bind(...params),
    banco.prepare('SELECT id FROM contatos WHERE id=?').bind(c.contatoId),
  ])
  if (exclusao.results.length)
    await audit({ action: 'contato.apagado', actorId: usuarioId })
  if (restante.results.length)
    return recusar(
      'Confira o acesso e as quantidades. Atualize o painel e confirme novamente.',
    )
  await limparArquivosExcluidos(db, bucket, c.contatoId)
  return { ok: true, contatoId: c.contatoId }
}

export async function executarComando(
  db: Banco,
  bucket: Pick<R2Bucket, 'delete'>,
  usuarioId: string,
  c: ComandoCarteira,
): Promise<Resultado> {
  const acesso = await setoresVisiveis(db, usuarioId)
  if (acesso.papel !== 'gestor' && !acesso.setores.length) return semAcesso()
  if (
    c?.tipo === 'criarNota' ||
    c?.tipo === 'criarNotaInterna' ||
    c?.tipo === 'editarNota' ||
    c?.tipo === 'apagarNota'
  ) {
    if (
      !(c.tipo === 'criarNota' || c.tipo === 'criarNotaInterna'
        ? idNovo(c.id)
        : idValido(c.id)) ||
      (c.tipo === 'criarNotaInterna' && !idValido(c.conversaId)) ||
      !idValido(c.contatoId)
    )
      return semAcesso()
    return gravarNota(db, acesso.numeros, usuarioId, c)
  }
  if (c?.tipo === 'retorno') return gravarRetorno(db, acesso, usuarioId, c)
  if (c?.tipo === 'criarContato') return criarContato(db, acesso, c)
  if (c?.tipo === 'abrirNegocio') return abrirNegocio(db, acesso, usuarioId, c)
  if (c?.tipo === 'moverNegocio') return moverNegocio(db, acesso, c)
  if (c?.tipo === 'editarContato')
    return editarContato(db, acesso, usuarioId, c)
  if (c?.tipo === 'trocarResponsavel') return trocarResponsavel(db, acesso, c)
  if (c?.tipo === 'apagarContato') {
    if (acesso.papel !== 'gestor') return semAcesso()
    return apagarContato(db, bucket, usuarioId, c)
  }
  return recusar('Operação indisponível.')
}
