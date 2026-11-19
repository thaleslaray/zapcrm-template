import { currentD1Session } from '#/db/d1-session'
import { type CredencialInstancia, chamarInstancia, objeto } from './uazapi'
import {
  type Aviso,
  estadoRemoto,
  lerAviso,
  lerMensagem,
  type MensagemWa,
  telefoneRemoto,
} from './wa-avisos-formato'
import { telefonesDaConta } from './wa-chat-formato'
import { gravarChats } from './wa-chats'
import { aplicarResultadoManual } from './wa-historico-resultado'
import { lotesWa } from './wa-lotes'
import { marcaChatExcluido, marcaReentrega } from './wa-mensagens-excluidas'
import { copiarMidia } from './wa-midia'

// Toda etapa do lote vê os identificadores que as etapas anteriores resolveram.
// A origem de dados é um único parâmetro JSON, inclusive para páginas com 100
// mensagens. As seleções correlatas usam os índices de telefone, JID, LID e ID.
export const cargaPendente = `EXISTS(SELECT 1 FROM avisos_pendentes a WHERE a.numero_id=numeros.id
  AND (a.conteudo->>'tipo'='chats' OR (a.conteudo->>'tipo'='mensagens' AND a.conteudo->>'historico'=1))
  AND (a.conteudo->>'pedido'=numeros.historico_pedido OR json_type(a.conteudo,'$.pedido') IS NULL))`

const entrada = `WITH dados AS (
  SELECT value AS m, value->>'contatoNovo' AS contatoNovo, value->>'localId' AS localId,
    value->>'chaveTelefone' AS telefoneChave, value->>'jid' AS jid, value->>'lid' AS lid
  FROM json_each(?1) j JOIN numeros n ON n.id=?2 AND n.token_cifrado IS ?3
  WHERE NOT EXISTS (SELECT 1 FROM json_each(j.value,'$.telefones') WHERE value=replace(n.telefone,'+',''))
    AND NOT EXISTS (SELECT 1 FROM mensagens_excluidas WHERE marca IN (j.value->>'marca',j.value->>'marcaTelefone',j.value->>'marcaLid'))
), alvos AS (
  SELECT dados.*, coalesce(
    (SELECT id FROM contatos WHERE telefone_normalizado=dados.telefoneChave),
    (SELECT contato_id FROM conversas WHERE numero_id=?2 AND jid=dados.jid),
    (SELECT contato_id FROM conversas WHERE numero_id=?2 AND lid=dados.lid),
    contatoNovo) AS contato FROM dados
), chats AS (
  SELECT alvos.*, c.id AS conversa FROM alvos JOIN conversas c
    ON c.numero_id=?2 AND c.contato_id=alvos.contato
)`

type BancoAvisos = Pick<D1Database, 'prepare' | 'batch'>

async function gravarMensagens(
  db: BancoAvisos,
  numero: string,
  mensagens: MensagemWa[],
  historico: boolean,
  vinculo: string | null,
) {
  if (!mensagens.length) return 0
  const contatosNovos = new Map<string, string>()
  const dados = mensagens.map((m) => {
    const chave = m.chaveTelefone ?? m.lid ?? m.identificador
    const contatoNovo = contatosNovos.get(chave) ?? crypto.randomUUID()
    contatosNovos.set(chave, contatoNovo)
    return {
      ...m,
      marca: marcaReentrega(numero, m.identificador),
      telefones: telefonesDaConta(m.chaveTelefone),
      marcaTelefone:
        historico && m.chaveTelefone
          ? marcaChatExcluido(null, m.chaveTelefone)
          : null,
      marcaLid: historico && m.lid ? marcaChatExcluido(numero, m.lid) : null,
      contatoNovo,
      localId: crypto.randomUUID(),
      conversaNova: crypto.randomUUID(),
      negocioNovo: crypto.randomUUID(),
    }
  })
  const json = JSON.stringify(dados)
  // ASVS 1.2.4: nenhuma parte do aviso compõe o texto SQL.
  const stmt = (sql: string) =>
    db.prepare(`${entrada} ${sql}`).bind(json, numero, vinculo)
  const lote = [
    stmt(`INSERT INTO contatos(id,nome,telefone,telefone_normalizado,nome_editado)
      SELECT contatoNovo, m->>'nome', m->>'telefone', telefoneChave,0 FROM alvos
      WHERE contato=contatoNovo ON CONFLICT DO NOTHING`),
    stmt(`UPDATE contatos SET
      telefone=coalesce(contatos.telefone,a.m->>'telefone'),
      telefone_normalizado=coalesce(contatos.telefone_normalizado,a.telefoneChave),
      nome=CASE WHEN contatos.nome_editado=0 AND (contatos.nome=contatos.telefone OR contatos.nome='Contato do WhatsApp')
        THEN a.m->>'nome' ELSE contatos.nome END
      FROM alvos a WHERE contatos.id=a.contato AND (
        (contatos.telefone_normalizado IS NULL AND a.telefoneChave IS NOT NULL) OR
        (contatos.nome_editado=0 AND (contatos.nome=contatos.telefone OR contatos.nome='Contato do WhatsApp')
         AND a.m->>'nome' <> contatos.nome AND a.m->>'nome' <> 'Contato do WhatsApp'))`),
    stmt(`INSERT INTO conversas(id,numero_id,contato_id,jid,lid)
      SELECT m->>'conversaNova',?2,contato,jid,lid FROM alvos WHERE 1
      ON CONFLICT(numero_id,contato_id) DO UPDATE SET jid=coalesce(conversas.jid,excluded.jid),
        lid=coalesce(conversas.lid,excluded.lid)`),
    stmt(`UPDATE mensagens SET identificador=m->>'identificador',marca_reentrega=m->>'marca',identificador_provedor=m->>'idDownload',
      estado=CASE WHEN mensagens.estado='lida' OR m->>'estado'='lida' THEN 'lida'
        WHEN mensagens.estado='entregue' OR m->>'estado'='entregue' THEN 'entregue'
        WHEN m->>'estado' IS NULL THEN mensagens.estado
        WHEN m->>'estado'='falha' OR (mensagens.estado='falha' AND mensagens.identificador IS NOT NULL) THEN 'falha'
        WHEN mensagens.estado='enviada' THEN 'enviada' ELSE m->>'estado' END
      FROM chats WHERE m->>'de' AND mensagens.numero_id=?2 AND mensagens.conversa_id=conversa
        AND direcao='enviada' AND (mensagens.identificador=m->>'identificador' OR
          (mensagens.id=m->>'trackId' AND mensagens.identificador IS NULL))`),
    stmt(`INSERT INTO mensagens(id,numero_id,conversa_id,identificador,identificador_provedor,direcao,tipo,estado,texto,interativa,instante,arquivo_nome,duracao_segundos,recebimento_ao_vivo,marca_reentrega)
      SELECT localId,?2,conversa,m->>'identificador',m->>'idDownload',CASE WHEN m->>'de' THEN 'enviada' ELSE 'recebida' END,
        m->>'tipo',coalesce(m->>'estado','fila'),m->>'texto',m->>'interativa',m->>'instante',m->>'arquivoNome',m->>'duracao',0,m->>'marca' FROM chats WHERE 1
      ON CONFLICT(numero_id,identificador) DO NOTHING`),
    stmt(`UPDATE conversas SET ultima_mensagem_em=max(coalesce(ultima_mensagem_em,0),novas.instante)
      FROM (SELECT conversa,max(m->>'instante') AS instante FROM chats GROUP BY conversa) novas
      WHERE id=novas.conversa`),
  ]
  if (mensagens.some((m) => m.edita)) {
    // O WhatsApp mostra a edição no lugar da mensagem original. O texto novo
    // entra na linha antiga e a linha da edição sai, antes de qualquer contagem.
    const edicoes = `SELECT conversa, m->>'edita' AS original, m->>'identificador' AS edicao, m->>'texto' AS texto
      FROM chats WHERE m->>'edita' IS NOT NULL AND EXISTS (SELECT 1 FROM mensagens o
        WHERE o.numero_id=?2 AND o.conversa_id=conversa AND o.identificador=m->>'edita')`
    lote.push(
      stmt(`, e AS (${edicoes}) UPDATE mensagens SET texto=e.texto, editada=1 FROM e
        WHERE mensagens.numero_id=?2 AND mensagens.conversa_id=e.conversa AND mensagens.identificador=e.original`),
      stmt(`, e AS (${edicoes}) DELETE FROM mensagens WHERE numero_id=?2
        AND identificador IN (SELECT edicao FROM e)`),
    )
  }
  if (mensagens.some((m) => m.interativa || m.respostaInterativa)) {
    // A linha antiga conserva o identificador, a entrega e a contagem de novas mensagens.
    lote.push(
      stmt(`UPDATE mensagens SET
      interativa=coalesce(m->>'interativa', mensagens.interativa),
      texto=coalesce(m->>'texto', mensagens.texto)
      FROM chats WHERE mensagens.numero_id=?2 AND mensagens.conversa_id=conversa
        AND mensagens.identificador=m->>'identificador' AND (
          (m->>'interativa' IS NOT NULL AND (mensagens.interativa IS NULL OR
            (json_array_length(mensagens.interativa,'$.opcoes')=0 AND json_array_length(m,'$.interativa.opcoes')>0))) OR
          (m->>'respostaInterativa' AND mensagens.texto IS NOT m->>'texto')
        )`),
    )
  }
  if (!historico) {
    // O primeiro aviso ao vivo também promove a mensagem que o histórico trouxe
    // durante a queda. A marca e os efeitos mudam juntos nesta transação.
    const recebidas = `SELECT msg.id,msg.conversa_id,msg.instante FROM mensagens msg
      WHERE msg.numero_id=?2 AND msg.direcao='recebida' AND msg.recebimento_ao_vivo=0
      AND msg.identificador IN (SELECT m->>'identificador' FROM dados)`
    lote.push(
      stmt(`, novas AS (${recebidas}) UPDATE conversas SET nao_lidas=nao_lidas+q.quantidade
        FROM (SELECT v.conversa_id,count(*) AS quantidade FROM novas v JOIN conversas cv ON cv.id=v.conversa_id
          WHERE cv.nao_lidas_em IS NULL OR v.instante>cv.nao_lidas_em GROUP BY v.conversa_id) q
        WHERE id=q.conversa_id`),
      stmt(`, novas AS (${recebidas}) INSERT INTO negocios(id,contato_id,numero_id,funil_id,etapa_id)
        SELECT m->>'negocioNovo',contato,n.id,n.funil_padrao_id,
          (SELECT e.id FROM etapas e WHERE e.funil_id=n.funil_padrao_id AND e.fechamento IS NULL ORDER BY e.posicao,e.id LIMIT 1)
        FROM chats JOIN numeros n ON n.id=?2 WHERE conversa IN (SELECT conversa_id FROM novas)
        AND EXISTS (SELECT 1 FROM etapas e WHERE e.funil_id=n.funil_padrao_id AND e.fechamento IS NULL)
        ON CONFLICT DO NOTHING`),
      stmt(
        `UPDATE mensagens SET recebimento_ao_vivo=1 WHERE id IN (SELECT id FROM (${recebidas}))`,
      ),
    )
  }
  const resultados = await db.batch(lote)
  // O quinto comando insere as mensagens que ainda não estavam no histórico.
  return resultados[4].meta.changes
}

async function gravarRecibo(
  db: BancoAvisos,
  numero: string,
  vinculo: string | null,
  aviso: Extract<Aviso, { tipo: 'recibo' }>,
) {
  const ids = JSON.stringify(aviso.ids)
  await db.batch([
    db
      .prepare(`INSERT INTO recibos_pendentes(numero_id,identificador,nivel)
          SELECT ?,i.value,? FROM json_each(?) i WHERE NOT EXISTS
          (SELECT 1 FROM mensagens m WHERE m.numero_id=? AND m.identificador=i.value) AND EXISTS (SELECT 1 FROM numeros WHERE id=? AND token_cifrado IS ?)
          ON CONFLICT(numero_id,identificador) DO UPDATE SET nivel=CASE
          WHEN max(nivel,excluded.nivel)>=2 THEN max(nivel,excluded.nivel)
          ELSE min(nivel,excluded.nivel) END`)
      .bind(numero, aviso.nivel, ids, numero, numero, vinculo),
    db
      .prepare(`UPDATE mensagens SET estado=CASE
          WHEN estado='lida' OR ?=3 THEN 'lida' WHEN estado='entregue' OR ?=2 THEN 'entregue'
          WHEN estado='falha' OR ?=-1 THEN 'falha' ELSE 'enviada' END WHERE numero_id=? AND direcao='enviada'
          AND identificador IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM numeros WHERE id=? AND token_cifrado IS ?)`)
      .bind(
        aviso.nivel,
        aviso.nivel,
        aviso.nivel,
        numero,
        ids,
        numero,
        vinculo,
      ),
  ])
}

// O ingresso já validou o vínculo e normalizou o conteúdo. Na troca de
// servidor só consolidamos o que o D1 recebeu; chamadas de mídia não pertencem
// ao novo servidor. O processamento normal da fila ainda pode copiar o arquivo
// pelo host original até o instante em que a configuração for efetivada.
export async function consolidarAvisoLocal(
  db: BancoAvisos,
  tarefa: { numeroId: string; vinculo: string | null; conteudo: string },
) {
  const aviso: Aviso = JSON.parse(tarefa.conteudo)
  if (aviso.tipo === 'mensagens') {
    await gravarMensagens(
      db,
      tarefa.numeroId,
      aviso.mensagens,
      aviso.historico,
      tarefa.vinculo,
    )
  } else if (aviso.tipo === 'chats') {
    await gravarChats(db, tarefa.numeroId, tarefa.vinculo, aviso.chats)
  } else if (aviso.tipo === 'recibo') {
    await gravarRecibo(db, tarefa.numeroId, tarefa.vinculo, aviso)
  } else throw new Error('Aviso pendente inválido para a troca de servidor.')
}

export async function executarAviso(
  env: Env,
  numero: string,
  credencial: CredencialInstancia,
  aviso: Aviso,
  varrerAgora = true,
) {
  const db = currentD1Session() ?? env.DB
  switch (aviso.tipo) {
    case 'mensagens':
      await gravarMensagens(
        db,
        numero,
        aviso.mensagens,
        aviso.historico,
        credencial.vinculo,
      )
      for (const m of aviso.mensagens) {
        if (m.tipo !== 'texto') await copiarMidia(env, numero, credencial, m)
      }
      return
    case 'recibo':
      return gravarRecibo(db, numero, credencial.vinculo, aviso)
    case 'carga': {
      // Um complete vale também para o loading da MESMA ordem entregue depois.
      // Guardamos ordem+1 positiva para loading e negativa para complete.
      const pos = aviso.ordem + 1
      const alterado = await db
        .prepare(`UPDATE numeros SET sincronizando_historico=(? OR ${cargaPendente}),historico_ordem=?
        WHERE id=? AND token_cifrado=? AND historico_pedido=?
        AND (abs(historico_ordem) < ? OR (abs(historico_ordem)=? AND historico_ordem>=0))
        RETURNING estado`)
        .bind(
          Number(!aviso.terminou),
          aviso.terminou ? -pos : pos,
          numero,
          credencial.vinculo,
          aviso.pedido,
          pos,
          pos,
        )
        .first<string>('estado')
      if (varrerAgora && aviso.terminou && alterado === 'conectado') {
        const { reconciliarNumero } = await import('./wa-numeros-historico')
        await reconciliarNumero(env, numero, credencial)
      }
      return
    }
    case 'resultado-manual':
      return aplicarResultadoManual(db, numero, credencial.vinculo, aviso)
    case 'conexao': {
      // O evento de conexão não tem um relógio monotônico. Um aviso antigo
      // ou retomado no cron jamais deve derrubar uma sessão já restabelecida.
      const remoto = objeto(
        await chamarInstancia(
          credencial.endereco,
          credencial.token,
          '/instance/status',
        ),
      )
      const instancia = objeto(remoto.instance)
      const estado = estadoRemoto(instancia.status)
      const telefone = telefoneRemoto(instancia.owner) ?? aviso.telefone
      await db
        .prepare(`UPDATE numeros SET estado=?,estado_em=?,telefone=coalesce(?,telefone),
          sincronizando_historico=CASE WHEN ?='desconectado' THEN 0 ELSE sincronizando_historico END
          WHERE id=? AND (estado<>? OR telefone IS NULL) AND token_cifrado=?`)
        .bind(
          estado,
          Date.now(),
          telefone,
          estado,
          numero,
          estado,
          credencial.vinculo,
        )
        .run()
      if (
        varrerAgora &&
        estado === 'conectado' &&
        aviso.estado === 'conectado'
      ) {
        const { reconciliarNumero } = await import('./wa-numeros-historico')
        await reconciliarNumero(env, numero, credencial)
      }
      return
    }
    case 'chats':
      await gravarChats(db, numero, credencial.vinculo, aviso.chats)
      return
    case 'chat':
      // Preserva o nome editado pela equipe, completando contatos sem nome.
      await db
        .prepare(`UPDATE contatos SET nome=? WHERE nome_editado=0 AND (nome=telefone OR nome='Contato do WhatsApp')
        AND id IN (SELECT contato_id FROM conversas WHERE numero_id=? AND (jid=? OR lid=?)) AND EXISTS (SELECT 1 FROM numeros WHERE id=? AND token_cifrado=?)`)
        .bind(
          aviso.nome,
          numero,
          aviso.jid,
          aviso.jid,
          numero,
          credencial.vinculo,
        )
        .run()
      return
  }
}

export async function processarAviso(
  env: Env,
  numeroId: string,
  credencial: CredencialInstancia,
  aviso: unknown,
) {
  for (const tarefa of lerAviso(aviso))
    await executarAviso(env, numeroId, credencial, tarefa)
}

export async function gravarHistorico(
  env: Env,
  numeroId: string,
  credencial: CredencialInstancia,
  valores: unknown[],
) {
  const mensagens = valores.map((v) => lerMensagem(v)).filter((m) => m !== null)
  let novas = 0
  for (const lote of lotesWa(mensagens)) {
    novas += await gravarMensagens(
      currentD1Session() ?? env.DB,
      numeroId,
      lote,
      true,
      credencial.vinculo,
    )
    for (const m of lote) {
      if (m.tipo === 'texto') continue
      try {
        await copiarMidia(env, numeroId, credencial, m)
      } catch {
        // A página de /message/find não tem aviso próprio para retomar.
        // Guarda somente a mídia que falhou e continua os outros números.
        const tarefa: Aviso = {
          tipo: 'mensagens',
          pedido: null,
          historico: true,
          mensagens: [m],
        }
        const db = currentD1Session() ?? env.DB
        await db
          .prepare(`INSERT INTO avisos_pendentes(id,numero_id,conteudo)
          SELECT ?,id,? FROM numeros WHERE id=? AND token_cifrado=? ON CONFLICT DO NOTHING`)
          .bind(
            `arquivo:${marcaReentrega(numeroId, m.identificador)}`,
            JSON.stringify(tarefa),
            numeroId,
            credencial.vinculo,
          )
          .run()
      }
    }
  }
  return novas
}
