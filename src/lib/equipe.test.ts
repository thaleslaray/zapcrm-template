import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import { getDb } from '#/db'
import { convites, convitesSetores } from '#/db/schema'
import { setoresVisiveis } from '#/lib/acesso-crm'
import { createAuthHarness, ORIGIN } from '#/test/auth-harness'
import { medirFila } from '#/test/d1-fila'
import { atenderAutenticacao } from './auth'
import { alterarEquipe, listarEquipe } from './equipe'
import { enforceAccess } from './session-access'

it('o convite libera quem está fora da lista e aplica o papel e os setores ao entrar', async () => {
  const h = await createAuthHarness({
    ACCESS_ALLOWLIST: 'gestora@exemplo.test',
  })
  try {
    await h.signIn('gestora@exemplo.test')
    const db = getDb(h.db)
    await db.insert(convites).values({
      id: 'convite',
      email: 'bianca@exemplo.test',
      papel: 'vendedor',
    })
    await db
      .insert(convitesSetores)
      .values({ conviteId: 'convite', setorId: 'pos' })
    const entrada = await h.signIn('bianca@exemplo.test')
    expect(await setoresVisiveis(db, entrada.body.user.id)).toMatchObject({
      papel: 'vendedor',
      setores: ['pos'],
      funis: ['pos'],
    })
  } finally {
    await h.dispose()
  }
})

it('o banco preserva um gestor ativo inclusive no encerramento da própria conta', async () => {
  const h = await createAuthHarness()
  try {
    const { body } = await h.signIn('unica@exemplo.test')
    await expect(
      h.db
        .prepare('UPDATE user SET deleted_at=1 WHERE id=?')
        .bind(body.user.id)
        .run(),
    ).rejects.toThrow(/ULTIMO_GESTOR/)
  } finally {
    await h.dispose()
  }
})

it('a gestora convida, altera a equipe, cancela e remove; outra pessoa só vê o setor concedido', async () => {
  const h = await createAuthHarness({
    ACCESS_ALLOWLIST: 'titular@exemplo.test,colega@exemplo.test',
  })
  try {
    const db = getDb(h.db)
    const gestora = (await h.signIn('titular@exemplo.test')).body.user.id
    const colega = (await h.signIn('colega@exemplo.test')).body.user.id
    const entrada = 'https://crm.exemplo.test/login'
    await expect(listarEquipe(db, colega)).rejects.toThrow('Sem acesso')
    const cmd = {
      tipo: 'convidar',
      id: 'convite-filial',
      email: 'Nova@Exemplo.test',
      papel: 'vendedor',
      setores: ['pos'],
    } as const
    const convite = { ...cmd, setores: [...cmd.setores] }
    await expect(alterarEquipe(db, colega, convite, entrada)).rejects.toThrow(
      'Sem acesso',
    )
    const duplo = await Promise.all([
      alterarEquipe(db, gestora, convite, entrada),
      alterarEquipe(db, gestora, convite, entrada),
    ])
    expect(duplo.map((r) => r.endereco)).toEqual([entrada, entrada])
    expect((await listarEquipe(db, gestora)).convites).toEqual([
      {
        id: 'convite-filial',
        email: 'nova@exemplo.test',
        papel: 'vendedor',
        setores: ['pos'],
      },
    ])
    await alterarEquipe(
      db,
      gestora,
      { tipo: 'cancelarConvite', id: convite.id },
      entrada,
    )
    expect((await listarEquipe(db, gestora)).convites).toHaveLength(0)
    await expect(alterarEquipe(db, gestora, convite, entrada)).rejects.toThrow(
      'cancelado',
    )
    expect((await listarEquipe(db, gestora)).convites).toHaveLength(0)
    await alterarEquipe(
      db,
      gestora,
      { tipo: 'editarPessoa', id: colega, papel: 'vendedor', setores: ['pos'] },
      entrada,
    )
    expect((await setoresVisiveis(db, colega)).funis).toEqual(['pos'])
    await alterarEquipe(
      db,
      gestora,
      { tipo: 'removerPessoa', id: colega },
      entrada,
    )
    expect((await listarEquipe(db, gestora)).pessoas.map((p) => p.id)).toEqual([
      gestora,
    ])
    await expect(h.signIn('colega@exemplo.test')).rejects.toThrow(
      'código não apareceu',
    )
  } finally {
    await h.dispose()
  }
})

it('a leitura de equipe custa até duas idas em fila e duas alterações simultâneas preservam um gestor ativo', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const ana = (await h.signIn('ana@exemplo.test')).body.user.id
    const bia = (await h.signIn('bia@exemplo.test')).body.user.id
    const url = 'https://crm.exemplo.test/login'
    await alterarEquipe(
      db,
      ana,
      { tipo: 'editarPessoa', id: bia, papel: 'gestor', setores: [] },
      url,
    )
    const leitura = await medirFila(h.db, () => listarEquipe(getDb(h.db), ana))
    expect(leitura.resultado.pessoas.map((p) => p.papel)).toEqual([
      'gestor',
      'gestor',
    ])
    expect(leitura.filaMax).toBeLessThanOrEqual(2)
    const resultados = await Promise.allSettled([
      alterarEquipe(
        db,
        ana,
        { tipo: 'editarPessoa', id: ana, papel: 'vendedor', setores: ['pos'] },
        url,
      ),
      alterarEquipe(db, bia, { tipo: 'removerPessoa', id: bia }, url),
    ])
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const recusa = resultados.find((r) => r.status === 'rejected')
    expect(recusa?.reason.message).toMatch(/pelo menos um gestor/)
    const restante = resultados[0].status === 'fulfilled' ? bia : ana
    expect(
      (await listarEquipe(db, restante)).pessoas.filter(
        (p) => p.papel === 'gestor',
      ),
    ).toHaveLength(1)
  } finally {
    await h.dispose()
  }
})

it('o provedor recebe um aviso com o endereço, mesmo com o convite em duplicidade', async () => {
  const h = await createAuthHarness()
  try {
    const db = getDb(h.db)
    const ana = (await h.signIn('ana@exemplo.test')).body.user.id
    const send = vi.fn().mockResolvedValue({ messageId: 'local' })
    Object.assign(env, {
      EMAIL: { send },
      EMAIL_FROM: 'crm@exemplo.test',
      RESEND_API_KEY: '',
    })
    const entrada = 'https://crm.exemplo.test/login'
    const convite = {
      tipo: 'convidar' as const,
      id: 'aviso',
      email: 'bia@exemplo.test',
      papel: 'gestor' as const,
      setores: ['com'],
    }
    const respostas = await Promise.all([
      alterarEquipe(db, ana, convite, entrada),
      alterarEquipe(db, ana, convite, entrada),
    ])
    expect(respostas.map((r) => r.mensagem)).toContain(
      'Convite enviado por e-mail.',
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: convite.email,
        text: expect.stringContaining(entrada),
        html: expect.stringContaining(entrada),
      }),
    )
    send.mockRejectedValueOnce(new Error('Falha simulada'))
    const falha = await alterarEquipe(
      db,
      ana,
      { ...convite, id: 'falha', email: 'falha@exemplo.test' },
      entrada,
    )
    expect(falha.endereco).toBe(entrada)
    expect(falha.mensagem).toMatch(/envio do e-mail falhou/)
  } finally {
    Object.assign(env, { EMAIL: undefined, EMAIL_FROM: '', RESEND_API_KEY: '' })
    await h.dispose()
  }
})

it('um convite aceito só pode ser removido pela equipe e um novo convite não reativa a sessão antiga', async () => {
  const h = await createAuthHarness({
    ACCESS_ALLOWLIST: 'gestora@exemplo.test',
  })
  try {
    const entrada = 'https://crm.exemplo.test/login'
    const email = 'convidada@exemplo.test'
    const db = getDb(h.db)
    const gestora = (await h.signIn('gestora@exemplo.test')).body.user.id
    const comando = {
      tipo: 'convidar' as const,
      id: 'primeiro',
      email,
      papel: 'vendedor' as const,
      setores: ['com'],
    }
    await alterarEquipe(db, gestora, comando, entrada)
    const antiga = await h.signIn(email)
    const request = new Request(ORIGIN, { headers: { cookie: antiga.cookie } })
    const emCache = await h
      .getAuth(request)
      .api.getSession({ headers: request.headers })
    expect(emCache).toBeTruthy()
    await expect(
      alterarEquipe(
        db,
        gestora,
        { tipo: 'cancelarConvite', id: comando.id },
        entrada,
      ),
    ).rejects.toThrow('já aceitou')
    await alterarEquipe(
      db,
      gestora,
      { tipo: 'removerPessoa', id: antiga.body.user.id },
      entrada,
    )
    const consultar = new Request(`${ORIGIN}/api/auth/get-session`, {
      headers: { cookie: antiga.cookie },
    })
    const resposta = await atenderAutenticacao(h.env, consultar)
    expect(await resposta.json()).toBeNull()
    const editar = new Request(`${ORIGIN}/api/auth/update-user`, {
      method: 'POST',
      headers: {
        cookie: antiga.cookie,
        origin: ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Alteração após a remoção' }),
    })
    expect((await atenderAutenticacao(h.env, editar)).status).toBe(401)
    expect(await enforceAccess(h.env, emCache)).toBeNull()
    await expect(alterarEquipe(db, gestora, comando, entrada)).rejects.toThrow(
      'removida',
    )
    await alterarEquipe(
      db,
      gestora,
      { ...comando, id: 'segundo', setores: ['pos'] },
      entrada,
    )
    const nova = await h.signIn(email)
    expect(await enforceAccess(h.env, emCache)).toBeNull()
    const novaRequest = new Request(ORIGIN, {
      headers: { cookie: nova.cookie },
    })
    const sessaoNova = await h
      .getAuth(novaRequest)
      .api.getSession({ headers: novaRequest.headers })
    expect((await enforceAccess(h.env, sessaoNova))?.user.id).toBe(
      nova.body.user.id,
    )
    expect((await setoresVisiveis(db, nova.body.user.id)).setores).toEqual([
      'pos',
    ])
  } finally {
    await h.dispose()
  }
})

it('cancelar convite preserva a liberação independente pela lista da instalação', async () => {
  const h = await createAuthHarness({
    ACCESS_ALLOWLIST: 'gestora@exemplo.test,direto@exemplo.test',
  })
  try {
    const db = getDb(h.db)
    const autor = (await h.signIn('gestora@exemplo.test')).body.user.id
    await alterarEquipe(
      db,
      autor,
      {
        tipo: 'convidar',
        id: 'colega',
        email: 'direto@exemplo.test',
        papel: 'gestor',
        setores: ['pos'],
      },
      ORIGIN,
    )
    await alterarEquipe(
      db,
      autor,
      { tipo: 'cancelarConvite', id: 'colega' },
      ORIGIN,
    )
    const { acessoPorEmail } = await import('./acesso-email')
    expect(await acessoPorEmail(h.env, 'direto@exemplo.test')).toBe(true)
    expect((await listarEquipe(db, autor)).convites).toHaveLength(0)
  } finally {
    await h.dispose()
  }
})

it('só permite retirar o papel da gestora se outra puder entrar pela lista ou por convite', async () => {
  const h = await createAuthHarness({
    ACCESS_ALLOWLIST: 'ana@exemplo.test,bia@exemplo.test',
  })
  try {
    const db = getDb(h.db)
    const ana = (await h.signIn('ana@exemplo.test')).body.user.id
    const bia = (await h.signIn('bia@exemplo.test')).body.user.id
    await alterarEquipe(
      db,
      ana,
      { tipo: 'editarPessoa', id: bia, papel: 'gestor', setores: [] },
      ORIGIN,
    )
    Object.assign(env, { ACCESS_ALLOWLIST: 'ana@exemplo.test' })
    const comando = {
      tipo: 'editarPessoa',
      id: ana,
      papel: 'vendedor',
      setores: ['pos'],
    } as const
    await expect(
      alterarEquipe(
        db,
        ana,
        { ...comando, setores: [...comando.setores] },
        ORIGIN,
      ),
    ).rejects.toThrow('pelo menos um gestor')
    expect((await setoresVisiveis(db, ana)).papel).toBe('gestor')
    await expect(
      alterarEquipe(db, ana, { tipo: 'removerPessoa', id: ana }, ORIGIN),
    ).rejects.toThrow('pelo menos um gestor')
    await db.insert(convites).values({
      id: 'convite',
      email: 'bia@exemplo.test',
      papel: 'gestor',
      aceitoEm: new Date(),
    })
    await alterarEquipe(
      db,
      ana,
      { ...comando, setores: [...comando.setores] },
      ORIGIN,
    )
    expect((await setoresVisiveis(db, ana)).papel).toBe('vendedor')
  } finally {
    await h.dispose()
  }
})
