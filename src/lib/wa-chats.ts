import { currentD1Session } from '#/db/d1-session'
import type { CredencialInstancia } from './uazapi'
import { type ChatWa, lerChatWa, telefonesDaConta } from './wa-chat-formato'
import { lotesWa } from './wa-lotes'
import { marcaChatExcluido } from './wa-mensagens-excluidas'

const entrada = `WITH dados AS (
 SELECT j.value->>'id' AS novo,j.value->>'cv' AS conversaNova,j.value->>'chave' AS chave,
   j.value->>'telefone' AS telefone,j.value->>'jid' AS jid,j.value->>'lid' AS lid,
   j.value->>'nome' AS nome,j.value->>'instante' AS instante,j.value->>'naoLidas' AS naoLidas,
   j.value->>'fotoUrl' AS fotoUrl, j.value->>'previaTexto' AS previaTexto,
   j.value->>'previaTipo' AS previaTipo, coalesce(j.value->>'previaDirecao', CASE
     WHEN EXISTS (SELECT 1 FROM json_each(j.value,'$.remetenteTelefone') WHERE value=replace(n.telefone,'+','')) THEN 'enviada' END) AS previaDirecao
 FROM json_each(?1) j JOIN numeros n ON n.id=?2 AND n.token_cifrado IS ?3
 WHERE NOT EXISTS (SELECT 1 FROM json_each(j.value,'$.telefones') WHERE value=replace(n.telefone,'+',''))
 AND NOT EXISTS (SELECT 1 FROM mensagens_excluidas
   WHERE marca IN (j.value->>'marcaTelefone',j.value->>'marcaLid'))
), alvos AS (
 SELECT d.*,coalesce((SELECT id FROM contatos WHERE telefone_normalizado=d.chave),
   (SELECT contato_id FROM conversas WHERE numero_id=?2 AND lid=d.lid),
   (SELECT contato_id FROM conversas WHERE numero_id=?2 AND jid=d.jid),novo) AS contato
 FROM dados d
)`

// A data da última mensagem sozinha não diz se a equipe já aplicou a contagem
// daquele chat. A mensagem histórica pode chegar antes do primeiro snapshot.
const atualizarContagem = `excluded.nao_lidas_em IS NOT NULL
  AND (conversas.nao_lidas_em IS NULL OR excluded.nao_lidas_em>conversas.nao_lidas_em)
  AND NOT EXISTS (SELECT 1 FROM mensagens m WHERE m.conversa_id=conversas.id
    AND m.recebimento_ao_vivo=1 AND m.instante>=excluded.nao_lidas_em)`

// A reação conta como atividade. Só guardamos seu tipo se ainda não há uma
// prévia de conteúdo, inclusive quando as páginas chegam fora de ordem.
const atualizarPrevia = `excluded.previa_em IS NOT NULL AND (
  conversas.previa_em IS NULL OR (excluded.previa_tipo <> 'ReactionMessage' AND
    (conversas.previa_tipo = 'ReactionMessage' OR excluded.previa_em >= conversas.previa_em)))`

export async function gravarChats(
  db: Pick<D1Database, 'prepare' | 'batch'>,
  numero: string,
  vinculo: string | null,
  chats: ChatWa[],
) {
  let total = 0
  for (const pagina of lotesWa(chats)) {
    // Um PN e seu LID podem aparecer separados no mesmo lote.
    const porLid = new Map(
      pagina.filter((c) => c.chave && c.lid).map((c) => [c.lid, c.chave]),
    )
    const ids = new Map<string, string>()
    const dados = pagina.map((c) => {
      const identidade = c.chave ?? (c.lid && porLid.get(c.lid)) ?? c.identidade
      const id = ids.get(identidade) ?? crypto.randomUUID()
      ids.set(identidade, id)
      return {
        ...c,
        id,
        cv: crypto.randomUUID(),
        telefones: telefonesDaConta(c.chave),
        marcaTelefone: c.chave && marcaChatExcluido(null, c.chave),
        marcaLid: c.lid && marcaChatExcluido(numero, c.lid),
      }
    })
    const json = JSON.stringify(dados)
    const stmt = (s: string) =>
      db.prepare(`${entrada} ${s}`).bind(json, numero, vinculo)
    const [, , salvos] = await db.batch<{ id: string }>([
      stmt(`INSERT INTO contatos(id,nome,telefone,telefone_normalizado,nome_editado)
        SELECT novo,coalesce(nome,telefone,'Contato do WhatsApp'),telefone,chave,0 FROM alvos
        WHERE contato=novo ORDER BY telefone IS NULL ON CONFLICT DO NOTHING`),
      stmt(`UPDATE contatos SET
        foto_url=coalesce(a.fotoUrl,contatos.foto_url),
        telefone=coalesce(contatos.telefone,a.telefone),
        telefone_normalizado=coalesce(contatos.telefone_normalizado,a.chave),
        nome=CASE WHEN contatos.nome_editado=0 AND (contatos.nome=contatos.telefone OR contatos.nome='Contato do WhatsApp')
          THEN coalesce(a.nome,contatos.nome) ELSE contatos.nome END
        FROM alvos a WHERE contatos.id=a.contato`),
      stmt(`INSERT INTO conversas(id,numero_id,contato_id,jid,lid,ultima_mensagem_em,nao_lidas,nao_lidas_em,
          previa_texto,previa_tipo,previa_direcao,previa_em)
        SELECT conversaNova,?2,contato,jid,lid,instante,coalesce(naoLidas,0), CASE WHEN naoLidas IS NOT NULL THEN coalesce(instante,0) END,
          previaTexto,previaTipo,previaDirecao,CASE WHEN previaTipo IS NOT NULL THEN instante END FROM alvos WHERE 1
        ON CONFLICT(numero_id,contato_id) DO UPDATE SET jid=coalesce(conversas.jid,excluded.jid),
          lid=coalesce(conversas.lid,excluded.lid),
          previa_texto=CASE WHEN ${atualizarPrevia} THEN excluded.previa_texto ELSE conversas.previa_texto END,
          previa_tipo=CASE WHEN ${atualizarPrevia} THEN excluded.previa_tipo ELSE conversas.previa_tipo END,
          previa_direcao=CASE WHEN ${atualizarPrevia} THEN excluded.previa_direcao ELSE conversas.previa_direcao END,
          previa_em=CASE WHEN ${atualizarPrevia} THEN excluded.previa_em ELSE conversas.previa_em END,
          nao_lidas=CASE WHEN ${atualizarContagem} THEN excluded.nao_lidas ELSE conversas.nao_lidas END,
          nao_lidas_em=CASE WHEN ${atualizarContagem} THEN excluded.nao_lidas_em ELSE conversas.nao_lidas_em END,
          ultima_mensagem_em=coalesce(max(conversas.ultima_mensagem_em,excluded.ultima_mensagem_em),conversas.ultima_mensagem_em,excluded.ultima_mensagem_em)
        RETURNING id`),
    ])
    total += new Set(salvos.results.map((r) => r.id)).size
  }
  return total
}

export async function importarChats(
  env: Env,
  numero: string,
  credencial: CredencialInstancia,
  valores: unknown[],
  dono?: unknown,
) {
  const chats = valores.map((v) => lerChatWa(v, dono)).filter((c) => c !== null)
  return gravarChats(
    currentD1Session() ?? env.DB,
    numero,
    credencial.vinculo,
    chats,
  )
}
