import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from '#/db/auth-schema'
import type { Interativa } from '#/lib/wa-interativa'

// Trilha de auditoria (src/lib/audit.ts). Sem chave estrangeira para `user`
// de propósito: o registro sobrevive à exclusão da conta (aí o e-mail é
// apagado da linha e fica só o id). Nunca guarda segredo nem corpo de request.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    // `<area>.<verbo>`, ex.: auth.sign_in, account.avatar_set
    action: text('action').notNull(),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    // JSON com poucos campos primitivos (ou null)
    meta: text('meta'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_created_idx').on(table.createdAt),
    index('audit_log_action_idx').on(table.action),
  ],
)

// Contador diário de pedidos de código por e-mail (src/lib/otp-daily-cap.ts):
// uma linha por dia UTC (`AAAA-MM-DD`), apagada pelo cron depois de alguns dias.
export const otpDiario = sqliteTable('otp_diario', {
  dia: text('dia').primaryKey(),
  total: integer('total').notNull().default(0),
})

const id = () => text('id').primaryKey()
const criadoEm = () =>
  integer('criado_em', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)

// O marco sobrevive à exclusão da primeira conta. Um novo login não repõe
// as etapas que a equipe personalizou nem promove outro gestor.
export const instalacao = sqliteTable(
  'instalacao',
  {
    id: integer('id').primaryKey(),
    criadoEm: criadoEm(),
  },
  (t) => [check('instalacao_unica', sql`${t.id} = 1`)],
)

export const servidorUazapi = sqliteTable(
  'servidor_uazapi',
  {
    id: integer('id').primaryKey(),
    endereco: text('endereco').notNull(),
    tokenCifrado: text('token_cifrado').notNull(),
    salvoPor: text('salvo_por').references(() => user.id, {
      onDelete: 'set null',
    }),
    salvoEm: integer('salvo_em', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [check('servidor_uazapi_unico', sql`${t.id} = 1`)],
)

export const setores = sqliteTable('setores', {
  id: id(),
  nome: text('nome').notNull(),
})

export const funis = sqliteTable(
  'funis',
  {
    id: id(),
    setorId: text('setor_id')
      .notNull()
      .references(() => setores.id),
    nome: text('nome').notNull(),
    cor: text('cor').notNull(),
  },
  (t) => [uniqueIndex('funis_setor_id').on(t.setorId, t.id)],
)

export const etapas = sqliteTable(
  'etapas',
  {
    id: id(),
    funilId: text('funil_id')
      .notNull()
      .references(() => funis.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    cor: text('cor').notNull(),
    posicao: integer('posicao').notNull(),
    fechamento: text('fechamento', { enum: ['sucesso', 'perda'] }),
  },
  (t) => [
    check(
      'etapas_fechamento_valido',
      sql`${t.fechamento} IN ('sucesso','perda')`,
    ),
    uniqueIndex('etapas_funil_fechamento').on(t.funilId, t.fechamento),
    uniqueIndex('etapas_funil_id').on(t.funilId, t.id),
    index('etapas_ordem').on(t.funilId, t.posicao),
  ],
)

export const numeros = sqliteTable(
  'numeros',
  {
    id: id(),
    nome: text('nome').notNull(),
    telefone: text('telefone'),
    cor: text('cor').notNull(),
    setorId: text('setor_id')
      .notNull()
      .references(() => setores.id),
    funilPadraoId: text('funil_padrao_id').notNull(),
    estado: text('estado', {
      enum: ['conectado', 'conectando', 'desconectado'],
    })
      .notNull()
      .default('desconectado'),
    instanciaId: text('instancia_id').unique(),
    servidorOrigem: text('servidor_origem'),
    tokenCifrado: text('token_cifrado'),
    segredoWebhookHash: text('segredo_webhook_hash'),
    webhookVerificadoEm: integer('webhook_verificado_em', {
      mode: 'timestamp_ms',
    }),
    webhookReconciliacaoPendente: integer('webhook_reconciliacao_pendente', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    reconciliacaoCursor: text('reconciliacao_cursor'),
    reconciliacaoEm: integer('reconciliacao_em', { mode: 'timestamp_ms' }),
    diasHistorico: integer('dias_historico').notNull().default(90),
    sincronizandoHistorico: integer('sincronizando_historico', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    historicoPedido: text('historico_pedido'),
    historicoOrdem: integer('historico_ordem').notNull().default(0),
    estadoEm: integer('estado_em', { mode: 'timestamp_ms' }),
  },
  (t) => [
    foreignKey({
      columns: [t.setorId, t.funilPadraoId],
      foreignColumns: [funis.setorId, funis.id],
    }),
    index('numeros_setor').on(t.setorId),
  ],
)

const papeis = ['gestor', 'vendedor'] as const
export const pessoas = sqliteTable(
  'pessoas',
  {
    usuarioId: text('usuario_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    papel: text('papel', { enum: papeis }).notNull().default('vendedor'),
  },
  (t) => [
    check('pessoas_papel_valido', sql`${t.papel} IN ('gestor','vendedor')`),
  ],
)

export const pessoasSetores = sqliteTable(
  'pessoas_setores',
  {
    usuarioId: text('usuario_id')
      .notNull()
      .references(() => pessoas.usuarioId, { onDelete: 'cascade' }),
    setorId: text('setor_id')
      .notNull()
      .references(() => setores.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.setorId] })],
)

// Tem precedência sobre o segredo de instalação, inclusive para quem nunca entrou.
export const acessosRevogados = sqliteTable('acessos_revogados', {
  email: text('email').primaryKey(),
})

// Identificadores de comandos encerrados. Um reenvio de rede não pode conceder
// acesso depois de o gestor cancelar o convite ou remover a pessoa.
export const convitesEncerrados = sqliteTable('convites_encerrados', {
  id: id(),
})

export const convites = sqliteTable('convites', {
  id: id(),
  email: text('email').notNull().unique(),
  papel: text('papel', { enum: papeis }).notNull(),
  criadoEm: criadoEm(),
  aceitoEm: integer('aceito_em', { mode: 'timestamp_ms' }),
})

export const convitesSetores = sqliteTable(
  'convites_setores',
  {
    conviteId: text('convite_id')
      .notNull()
      .references(() => convites.id, { onDelete: 'cascade' }),
    setorId: text('setor_id')
      .notNull()
      .references(() => setores.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.conviteId, t.setorId] })],
)

export const contatos = sqliteTable('contatos', {
  id: id(),
  // O cadastro da equipe e as linhas anteriores à migração preservam o nome.
  nomeEditado: integer('nome_editado', { mode: 'boolean' })
    .notNull()
    .default(true),
  nome: text('nome').notNull(),
  empresa: text('empresa'),
  telefone: text('telefone'),
  fotoUrl: text('foto_url'),
  fotoChave: text('foto_chave'),
  fotoTentativaEm: integer('foto_tentativa_em', { mode: 'timestamp_ms' }),
  // Contato que chegou só por LID aguarda o telefone identificado pelo provedor.
  telefoneNormalizado: text('telefone_normalizado').unique(),
  criadoEm: criadoEm(),
})

export const negocios = sqliteTable(
  'negocios',
  {
    id: id(),
    contatoId: text('contato_id')
      .notNull()
      .references(() => contatos.id, { onDelete: 'cascade' }),
    funilId: text('funil_id')
      .notNull()
      .references(() => funis.id),
    etapaId: text('etapa_id').notNull(),
    numeroId: text('numero_id').references(() => numeros.id, {
      onDelete: 'set null',
    }),
    responsavelId: text('responsavel_id').references(() => pessoas.usuarioId, {
      onDelete: 'set null',
    }),
    origemId: text('origem_id').references((): AnySQLiteColumn => negocios.id, {
      onDelete: 'set null',
    }),
    valorCentavos: integer('valor_centavos'),
    criadoEm: criadoEm(),
    fechadoEm: integer('fechado_em', { mode: 'timestamp_ms' }),
  },
  (t) => [
    foreignKey({
      columns: [t.funilId, t.etapaId],
      foreignColumns: [etapas.funilId, etapas.id],
    }),
    uniqueIndex('negocios_abertos_contato_funil')
      .on(t.contatoId, t.funilId)
      .where(sql`${t.fechadoEm} IS NULL`),
    uniqueIndex('negocios_funil_origem').on(t.funilId, t.origemId),
    index('negocios_etapa').on(t.etapaId),
  ],
)

export const conversas = sqliteTable(
  'conversas',
  {
    id: id(),
    contatoId: text('contato_id')
      .notNull()
      .references(() => contatos.id, { onDelete: 'cascade' }),
    numeroId: text('numero_id')
      .notNull()
      .references(() => numeros.id),
    jid: text('jid'),
    lid: text('lid'),
    naoLidasEm: integer('nao_lidas_em', { mode: 'timestamp_ms' }),
    naoLidas: integer('nao_lidas').notNull().default(0),
    ultimaMensagemEm: integer('ultima_mensagem_em', { mode: 'timestamp_ms' }),
    previaTexto: text('previa_texto'),
    previaTipo: text('previa_tipo'),
    previaDirecao: text('previa_direcao', { enum: ['recebida', 'enviada'] }),
    previaEm: integer('previa_em', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('conversas_numero_contato').on(t.numeroId, t.contatoId),
    uniqueIndex('conversas_numero_jid').on(t.numeroId, t.jid),
    uniqueIndex('conversas_numero_lid').on(t.numeroId, t.lid),
    uniqueIndex('conversas_numero_id').on(t.numeroId, t.id),
    index('conversas_atividade').on(t.numeroId, t.ultimaMensagemEm),
  ],
)

export const pedidosHistorico = sqliteTable('pedidos_historico', {
  conversaId: text('conversa_id')
    .primaryKey()
    .references(() => conversas.id, { onDelete: 'cascade' }),
  pedidoId: text('pedido_id').notNull().unique(),
  estado: text('estado', {
    enum: [
      'pendente',
      'incerto',
      'mais',
      'inicio',
      'inacessivel',
      'expirado',
      'bloqueado',
      'inconclusivo',
      'falha',
    ],
  }).notNull(),
  iniciadoEm: integer('iniciado_em').notNull(),
  motivo: text('motivo'),
  proximo: text('proximo', { mode: 'json' }).$type<{
    number: string
    count: number
    messageid: string
    timestamp: number
    fromMe: boolean
  }>(),
})

export const mensagens = sqliteTable(
  'mensagens',
  {
    id: id(),
    conversaId: text('conversa_id').notNull(),
    numeroId: text('numero_id').notNull(),
    // Pode faltar até a resposta do envio. O id interno serve de track_id.
    identificador: text('identificador'),
    identificadorProvedor: text('identificador_provedor'),
    recebimentoAoVivo: integer('recebimento_ao_vivo', { mode: 'boolean' })
      .notNull()
      .default(true),
    marcaReentrega: text('marca_reentrega'),
    midiaRecusada: integer('midia_recusada', { mode: 'boolean' })
      .notNull()
      .default(false),
    tentativaEm: integer('tentativa_em', { mode: 'timestamp_ms' }),
    direcao: text('direcao', { enum: ['recebida', 'enviada'] }).notNull(),
    tipo: text('tipo', {
      enum: ['texto', 'foto', 'audio', 'documento'],
    }).notNull(),
    estado: text('estado', {
      enum: ['fila', 'enviada', 'entregue', 'lida', 'falha'],
    }).notNull(),
    texto: text('texto'),
    interativa: text('interativa', { mode: 'json' }).$type<Interativa>(),
    editada: integer('editada', { mode: 'boolean' }).notNull().default(false),
    arquivoChave: text('arquivo_chave'),
    arquivoUrl: text('arquivo_url'),
    arquivoMime: text('arquivo_mime'),
    arquivoNome: text('arquivo_nome'),
    arquivoBytes: integer('arquivo_bytes'),
    duracaoSegundos: integer('duracao_segundos'),
    instante: integer('instante', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.numeroId, t.conversaId],
      foreignColumns: [conversas.numeroId, conversas.id],
    }).onDelete('cascade'),
    uniqueIndex('mensagens_numero_identificador').on(
      t.numeroId,
      t.identificador,
    ),
    index('mensagens_conversa_instante').on(t.conversaId, t.instante),
  ],
)

export const mensagensExcluidas = sqliteTable(
  'mensagens_excluidas',
  {
    marca: text('marca').primaryKey(),
    excluidaEm: integer('excluida_em', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch()*1000)`),
  },
  (t) => [index('mensagens_excluidas_data').on(t.excluidaEm)],
)

export const etiquetas = sqliteTable('etiquetas', {
  id: id(),
  nome: text('nome').notNull().unique(),
  cor: text('cor').notNull(),
})

export const contatosEtiquetas = sqliteTable(
  'contatos_etiquetas',
  {
    contatoId: text('contato_id')
      .notNull()
      .references(() => contatos.id, { onDelete: 'cascade' }),
    etiquetaId: text('etiqueta_id')
      .notNull()
      .references(() => etiquetas.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.contatoId, t.etiquetaId] })],
)

export const notas = sqliteTable(
  'notas',
  {
    id: id(),
    contatoId: text('contato_id')
      .notNull()
      .references(() => contatos.id, { onDelete: 'cascade' }),
    // Preenchido apenas para a nota interna do chat.
    conversaId: text('conversa_id').references(() => conversas.id, {
      onDelete: 'cascade',
    }),
    autorId: text('autor_id').references(() => pessoas.usuarioId, {
      onDelete: 'set null',
    }),
    texto: text('texto').notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index('notas_contato').on(t.contatoId, t.criadoEm)],
)

export const retornos = sqliteTable(
  'retornos',
  {
    id: id(),
    contatoId: text('contato_id')
      .notNull()
      .references(() => contatos.id, { onDelete: 'cascade' }),
    numeroId: text('numero_id')
      .notNull()
      .references(() => numeros.id),
    responsavelId: text('responsavel_id').references(() => pessoas.usuarioId, {
      onDelete: 'set null',
    }),
    motivo: text('motivo').notNull(),
    marcadoPara: integer('marcado_para', { mode: 'timestamp_ms' }).notNull(),
    feitoEm: integer('feito_em', { mode: 'timestamp_ms' }),
  },
  (t) => [index('retornos_agenda').on(t.numeroId, t.marcadoPara)],
)

export const respostasRapidas = sqliteTable('respostas_rapidas', {
  id: id(),
  atalho: text('atalho').notNull().unique(),
  texto: text('texto').notNull(),
})

// Só guarda recibos que chegaram antes da associação do identificador à mensagem.
export const recibosPendentes = sqliteTable(
  'recibos_pendentes',
  {
    numeroId: text('numero_id')
      .notNull()
      .references(() => numeros.id, { onDelete: 'cascade' }),
    identificador: text('identificador').notNull(),
    nivel: integer('nivel').notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.numeroId, t.identificador] })],
)

// Lotes autenticados e sem credenciais. Somem após a cópia para o CRM e R2.
export const avisosPendentes = sqliteTable(
  'avisos_pendentes',
  {
    id: id(),
    numeroId: text('numero_id')
      .notNull()
      .references(() => numeros.id, { onDelete: 'cascade' }),
    conteudo: text('conteudo').notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index('avisos_pendentes_ordem').on(t.criadoEm)],
)

// O lote que apaga o contato guarda somente as chaves a expurgar do R2.
// Sem FK: a fila precisa sobreviver à cascata e a uma falha do bucket.
export const arquivosEmExclusao = sqliteTable(
  'arquivos_em_exclusao',
  {
    chave: text('chave').primaryKey(),
    limparApos: integer('limpar_apos').notNull().default(0),
    contatoId: text('contato_id').notNull(),
  },
  (t) => [index('arquivos_em_exclusao_contato').on(t.contatoId)],
)
