import { type SQL, sql } from 'drizzle-orm'
import type { getDb } from '#/db'
import { setoresVisiveis } from './acesso-crm'
import type {
  AlvoPainel,
  CatalogoCarteira,
  ConversaCarteira,
  EtapaCarteira,
  FiltrosContatos,
  FiltrosQuadro,
  FunilCarteira,
  IdentidadeContato,
  ListaCarteira,
  Marca,
  NegocioCarteira,
  NumeroCarteira,
  PainelCarteira,
  QuadroCarteira,
  ResumoNegocio,
  RetornoCarteira,
} from './carteira-leitura-tipos'
import { retornosVisiveis } from './retornos-leitura'

type Banco = ReturnType<typeof getDb>
type Acesso = Awaited<ReturnType<typeof setoresVisiveis>>
const semAcesso = () => new Error('Sem acesso')

// Uma lista ocupa um parâmetro também quando o gestor acompanha muitos setores.
const ids = (lista: string[]) =>
  sql`(SELECT value FROM json_each(${JSON.stringify(lista)}))`
const identidade = sql`c.id, c.nome, c.empresa, c.telefone, c.telefone_normalizado AS telefoneNormalizado`
const numeroDoNegocio = sql`coalesce(n.numero_id, (
  SELECT cv.numero_id FROM conversas cv JOIN numeros canal ON canal.id=cv.numero_id
  JOIN funis funil ON funil.id=n.funil_id AND funil.setor_id=canal.setor_id
  WHERE cv.contato_id=n.contato_id ORDER BY cv.ultima_mensagem_em DESC,cv.id LIMIT 1))`
const camposResumo = sql`f.nome AS funilNome, f.cor AS funilCor, e.nome AS etapaNome, e.cor AS etapaCor,
  u.name AS responsavelNome, n.fechado_em AS fechadoEm, e.fechamento`
const relacoesNegocio = sql`JOIN funis f ON f.id=n.funil_id JOIN etapas e ON e.id=n.etapa_id
  LEFT JOIN user u ON u.id=n.responsavel_id`

type LinhaNegocio = Omit<NegocioCarteira, 'origem' | 'chave'> & {
  origemId: string | null
  origemData: number | null
  origemNome: string | null
  origemValor: number | null
}
function lerNegocios(db: Banco, condicao: SQL, valorDaOrigem = false) {
  return db
    .all<LinhaNegocio>(sql`SELECT n.id, n.contato_id AS contatoId, n.funil_id AS funilId,
    n.etapa_id AS etapaId, ${numeroDoNegocio} AS numeroId, n.responsavel_id AS responsavelId,
    n.criado_em AS criadoEm, n.valor_centavos AS valorCentavos, ${camposResumo}, o.id AS origemId, o.fechado_em AS origemData,
    vendedor.name AS origemNome, ${valorDaOrigem ? sql`o.valor_centavos` : sql`NULL`} AS origemValor
    FROM negocios n ${relacoesNegocio}
    LEFT JOIN negocios o ON o.id=n.origem_id AND o.contato_id=n.contato_id
    LEFT JOIN user vendedor ON vendedor.id=o.responsavel_id
    WHERE ${condicao} ORDER BY n.fechado_em DESC, n.criado_em DESC, n.id`)
    .then((linhas) =>
      linhas.map(
        ({
          origemId,
          origemData,
          origemNome,
          origemValor,
          ...negocio
        }): NegocioCarteira => ({
          ...negocio,
          chave: negocio.id,
          origem: origemId
            ? {
                fechadoEm: origemData,
                responsavelNome: origemNome,
                valorCentavos: origemValor,
              }
            : null,
        }),
      ),
    )
}

async function catalogo(
  db: Banco,
  acesso: Acesso,
  apenasPessoasAtivas = false,
): Promise<CatalogoCarteira> {
  const gestor = acesso.papel === 'gestor'
  const [funis, etapas, numeros, papeis, etiquetas] = await Promise.all([
    db.all<FunilCarteira>(sql`SELECT id, nome, cor, setor_id AS setorId FROM funis
      WHERE id IN ${ids(acesso.funis)} ORDER BY id='vendas' DESC, nome`),
    db.all<EtapaCarteira>(sql`SELECT id, nome, cor, funil_id AS funilId, posicao, fechamento FROM etapas
      WHERE funil_id IN ${ids(acesso.funis)} ORDER BY funil_id, posicao, id`),
    db.all<NumeroCarteira>(sql`SELECT id, nome, cor, telefone, setor_id AS setorId, funil_padrao_id AS funilPadraoId
      FROM numeros WHERE id IN ${ids(acesso.numeros)} ORDER BY nome`),
    db.all<{
      id: string
      nome: string
      papel: 'gestor' | 'vendedor'
      setorId: string | null
    }>(sql`SELECT u.id, u.name AS nome, p.papel, ps.setor_id AS setorId
      FROM pessoas p JOIN user u ON u.id=p.usuario_id
      LEFT JOIN pessoas_setores ps ON ps.usuario_id=p.usuario_id AND ps.setor_id IN ${ids(acesso.setores)}
      WHERE (p.papel='gestor' OR ps.setor_id IS NOT NULL)
      ${apenasPessoasAtivas ? sql`AND u.deleted_at IS NULL` : sql.empty()} ORDER BY u.name`),
    db.all<Marca>(sql`SELECT id,nome,cor FROM etiquetas ORDER BY nome`),
  ])
  const equipe = new Map<string, CatalogoCarteira['pessoas'][number]>()
  for (const { id, nome, papel, setorId } of papeis) {
    const pessoa = equipe.get(id) ?? { id, nome, papel, setorIds: [] }
    if (setorId) pessoa.setorIds.push(setorId)
    equipe.set(id, pessoa)
  }
  return {
    gestor,
    funis,
    etapas,
    numeros,
    pessoas: [...equipe.values()],
    etiquetas,
  }
}

type PorContato<T> = T & { contatoId: string }
function agrupar<T extends { contatoId: string }>(lista: T[]) {
  const grupos = new Map<string, T[]>()
  for (const item of lista) {
    const grupo = grupos.get(item.contatoId)
    if (grupo) grupo.push(item)
    else grupos.set(item.contatoId, [item])
  }
  return grupos
}
function lerEtiquetas(db: Banco, contatos: SQL) {
  return db.all<
    PorContato<Marca>
  >(sql`SELECT ce.contato_id AS contatoId,t.id,t.nome,t.cor
    FROM contatos_etiquetas ce JOIN etiquetas t ON t.id=ce.etiqueta_id
    WHERE ce.contato_id IN (${contatos}) ORDER BY t.nome`)
}
function lerConversas(db: Banco, acesso: Acesso, contatos: SQL) {
  return db.all<
    PorContato<ConversaCarteira>
  >(sql`SELECT id,contato_id AS contatoId,numero_id AS numeroId,
    ultima_mensagem_em AS ultimaMensagemEm FROM conversas WHERE numero_id IN ${ids(acesso.numeros)}
    AND contato_id IN (${contatos}) ORDER BY ultima_mensagem_em DESC,id`)
}
function lerRetornos(db: Banco, acesso: Acesso, contatos: SQL) {
  return db.all<PorContato<RetornoCarteira>>(
    sql`SELECT * FROM (${retornosVisiveis(
      ids(acesso.numeros),
      sql`r.contato_id IN (${contatos})`,
    )}) ORDER BY marcadoPara,id`,
  )
}
function verificarSetor(acesso: Acesso) {
  if (acesso.papel !== 'gestor' && !acesso.setores.length)
    throw new Error('Aguardando o gestor liberar um setor para você')
}

export async function listarContatos(
  db: Banco,
  usuarioId: string,
  filtros: FiltrosContatos = {},
): Promise<ListaCarteira> {
  const acesso = await setoresVisiveis(db, usuarioId)
  verificarSetor(acesso)
  const condicoes: SQL[] = []
  if (filtros.etiquetaId)
    condicoes.push(
      sql`c.id IN (SELECT contato_id FROM contatos_etiquetas WHERE etiqueta_id=${filtros.etiquetaId})`,
    )
  if (filtros.etapaId || filtros.responsavelId) {
    const negocio = [sql`funil_id IN ${ids(acesso.funis)}`]
    if (filtros.etapaId) negocio.push(sql`etapa_id=${filtros.etapaId}`)
    else negocio.push(sql`fechado_em IS NULL`)
    if (filtros.responsavelId)
      negocio.push(sql`responsavel_id=${filtros.responsavelId}`)
    condicoes.push(
      sql`c.id IN (SELECT contato_id FROM negocios WHERE ${sql.join(negocio, sql` AND `)})`,
    )
  }
  const onde = condicoes.length ? sql.join(condicoes, sql` AND `) : sql`1`
  const contatosAlvo = sql`SELECT c.id FROM contatos c WHERE ${onde}`
  const [opcoes, contatos, negocios, etiquetas, conversas] = await Promise.all([
    catalogo(db, acesso),
    db.all<IdentidadeContato>(
      sql`SELECT ${identidade} FROM contatos c WHERE ${onde} ORDER BY c.nome,c.id`,
    ),
    lerNegocios(
      db,
      sql`n.fechado_em IS NULL AND n.funil_id IN ${ids(acesso.funis)} AND n.contato_id IN (${contatosAlvo})`,
    ),
    lerEtiquetas(db, contatosAlvo),
    lerConversas(db, acesso, contatosAlvo),
  ])
  const porNegocio = agrupar(negocios),
    porEtiqueta = agrupar(etiquetas),
    porConversa = agrupar(conversas)
  const busca = filtros.busca?.trim().toLocaleLowerCase('pt-BR') ?? ''
  const digitos = busca.replace(/\D/g, '')
  const lista = contatos
    .filter(
      (c) =>
        !busca ||
        [c.nome, c.empresa].some((t) =>
          t?.toLocaleLowerCase('pt-BR').includes(busca),
        ) ||
        (digitos.length > 0 &&
          c.telefone?.replace(/\D/g, '').includes(digitos)),
    )
    .map((c) => {
      const abertos = porNegocio.get(c.id) ?? []
      return {
        ...c,
        abertos,
        etiquetas: porEtiqueta.get(c.id) ?? [],
        conversa: porConversa.get(c.id)?.[0] ?? null,
        responsavelNome: abertos[0]?.responsavelNome ?? null,
        valorCentavos: abertos.reduce(
          (s, n) => s + (n.origem ? 0 : (n.valorCentavos ?? 0)),
          0,
        ),
      }
    })
  const ordem =
    filtros.ordem === 'valor'
      ? (c: ListaCarteira['contatos'][number]) => c.valorCentavos
      : (c: ListaCarteira['contatos'][number]) =>
          c.conversa?.ultimaMensagemEm ?? 0
  lista.sort(
    (a, b) => (ordem(a) - ordem(b)) * (filtros.direcao === 'asc' ? 1 : -1),
  )
  return { ...opcoes, contatos: lista }
}

export async function lerQuadro(
  db: Banco,
  usuarioId: string,
  filtros: FiltrosQuadro = {},
): Promise<QuadroCarteira> {
  const acesso = await setoresVisiveis(db, usuarioId)
  verificarSetor(acesso)
  const funilId =
    filtros.funilId ??
    (acesso.funis.includes('vendas') ? 'vendas' : acesso.funis[0])
  if (funilId && !acesso.funis.includes(funilId)) throw semAcesso()
  if (filtros.numeroId && !acesso.numeros.includes(filtros.numeroId))
    throw semAcesso()
  const condicoes = [
    sql`n.funil_id=${funilId ?? null}`,
    sql`(n.fechado_em IS NULL OR n.fechado_em >= ${Date.now() - 30 * 86400000})`,
  ]
  if (filtros.responsavelId)
    condicoes.push(sql`n.responsavel_id=${filtros.responsavelId}`)
  if (filtros.numeroId)
    condicoes.push(sql`${numeroDoNegocio}=${filtros.numeroId}`)
  const onde = sql.join(condicoes, sql` AND `)
  const contatosAlvo = sql`SELECT n.contato_id FROM negocios n WHERE ${onde}`
  const [opcoes, negocios, contatos, etiquetas, conversas, retornos] =
    await Promise.all([
      catalogo(db, acesso),
      lerNegocios(db, onde),
      db.all<IdentidadeContato>(
        sql`SELECT ${identidade} FROM contatos c WHERE c.id IN (${contatosAlvo})`,
      ),
      lerEtiquetas(db, contatosAlvo),
      lerConversas(db, acesso, contatosAlvo),
      lerRetornos(db, acesso, contatosAlvo),
    ])
  const porContato = new Map(contatos.map((c) => [c.id, c])),
    porEtiqueta = agrupar(etiquetas),
    porConversa = agrupar(conversas),
    porRetorno = agrupar(retornos)
  const funil = opcoes.funis.find((f) => f.id === funilId) ?? null
  const numerosSetor = new Set(
    opcoes.numeros.filter((n) => n.setorId === funil?.setorId).map((n) => n.id),
  )
  const cartoes = negocios.flatMap((n) => {
    const contato = porContato.get(n.contatoId)
    if (!contato) return []
    const lista = porConversa.get(contato.id) ?? []
    const conversa =
      lista.find((v) => v.numeroId === n.numeroId) ??
      lista.find((v) => numerosSetor.has(v.numeroId)) ??
      null
    const retorno =
      porRetorno
        .get(contato.id)
        ?.find((r) =>
          n.numeroId ? r.numeroId === n.numeroId : numerosSetor.has(r.numeroId),
        ) ?? null
    return [
      {
        ...n,
        contato,
        conversa,
        etiquetas: porEtiqueta.get(contato.id) ?? [],
        retorno,
      },
    ]
  })
  return { ...opcoes, funil, cartoes }
}

export async function lerPainel(
  db: Banco,
  usuarioId: string,
  alvo: AlvoPainel,
): Promise<PainelCarteira> {
  const acesso = await setoresVisiveis(db, usuarioId)
  verificarSetor(acesso)
  if (alvo.funilId && !acesso.funis.includes(alvo.funilId)) throw semAcesso()
  if (!alvo.contatoId && !alvo.conversaId) throw semAcesso()
  const condicoes: SQL[] = []
  if (alvo.contatoId) condicoes.push(sql`c.id=${alvo.contatoId}`)
  if (alvo.conversaId)
    condicoes.push(
      sql`c.id=(SELECT contato_id FROM conversas WHERE id=${alvo.conversaId} AND numero_id IN ${ids(acesso.numeros)})`,
    )
  const onde = sql.join(condicoes, sql` AND `),
    contatoAlvo = sql`SELECT c.id FROM contatos c WHERE ${onde}`
  const [
    opcoes,
    [contato],
    negocios,
    resumos,
    conversas,
    etiquetasContato,
    retornos,
    notas,
  ] = await Promise.all([
    catalogo(db, acesso, true),
    db.all<IdentidadeContato>(
      sql`SELECT ${identidade} FROM contatos c WHERE ${onde}`,
    ),
    lerNegocios(
      db,
      sql`n.contato_id IN (${contatoAlvo}) AND n.funil_id IN ${ids(acesso.funis)}`,
      true,
    ),
    db
      .all<ResumoNegocio>(sql`SELECT n.id AS chave, ${camposResumo},
      CASE WHEN n.fechado_em IS NOT NULL THEN n.valor_centavos END AS valorCentavos FROM negocios n ${relacoesNegocio}
      WHERE n.contato_id IN (${contatoAlvo}) AND n.funil_id NOT IN ${ids(acesso.funis)}
      ORDER BY n.fechado_em DESC,n.criado_em DESC,n.id`)
      .then((linhas) =>
        Promise.all(
          linhas.map(async (linha) => {
            // Chave de apresentação estável, sem o identificador operacional de outro setor.
            const hash = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(linha.chave),
            )
            return {
              ...linha,
              chave: btoa(String.fromCharCode(...new Uint8Array(hash))),
            }
          }),
        ),
      ),
    lerConversas(db, acesso, contatoAlvo),
    lerEtiquetas(db, contatoAlvo),
    lerRetornos(db, acesso, contatoAlvo),
    db.all<
      PainelCarteira['notas'][number]
    >(sql`SELECT t.id,t.texto, u.name AS autorNome, t.criado_em AS criadoEm
      FROM notas t LEFT JOIN user u ON u.id=t.autor_id WHERE t.contato_id IN (${contatoAlvo}) AND t.conversa_id IS NULL ORDER BY t.criado_em DESC,t.id`),
  ])
  if (!contato) throw semAcesso()
  const setorAlvo = opcoes.funis.find((f) => f.id === alvo.funilId)?.setorId
  const conversa = alvo.conversaId
    ? conversas.find((v) => v.id === alvo.conversaId)
    : conversas.find(
        (v) =>
          !setorAlvo ||
          opcoes.numeros.some(
            (n) => n.id === v.numeroId && n.setorId === setorAlvo,
          ),
      )
  const numero = opcoes.numeros.find((n) => n.id === conversa?.numeroId)
  const funilId =
    alvo.funilId ??
    numero?.funilPadraoId ??
    negocios.find((n) => !n.fechadoEm)?.funilId ??
    negocios[0]?.funilId
  const doFunil = negocios.filter((n) => n.funilId === funilId)
  const principal =
    doFunil.find((n) => n.fechadoEm === null) ?? doFunil[0] ?? null
  const outros: ResumoNegocio[] = [
    ...negocios.filter((n) => n.id !== principal?.id),
    ...resumos,
  ].filter((n) => n.fechadoEm === null)
  const historico: ResumoNegocio[] = [...negocios, ...resumos]
    .filter((n) => n.fechadoEm !== null)
    .sort((a, b) => (b.fechadoEm ?? 0) - (a.fechadoEm ?? 0))
  return {
    ...opcoes,
    contato,
    conversaAtivaId: conversa?.id ?? null,
    principal,
    outros,
    historico,
    conversas,
    etiquetasContato,
    retorno: conversa
      ? (retornos.find((r) => r.numeroId === conversa.numeroId) ?? null)
      : (retornos.find(
          (r) => !principal?.numeroId || r.numeroId === principal.numeroId,
        ) ?? null),
    notas,
    totalNegocios: negocios.length + resumos.length,
  }
}
