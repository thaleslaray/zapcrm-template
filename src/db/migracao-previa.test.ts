import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from 'vitest'

test('a atualização da 0013 conserva o texto original e remove só o marcador inicial com conteúdo', () => {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
  })
  try {
    const migracoes = readdirSync('drizzle')
      .filter((nome) => nome.endsWith('.sql'))
      .sort()
    for (const nome of migracoes.filter((nome) => nome < '0014')) {
      db.exec(readFileSync(`drizzle/${nome}`, 'utf8'))
    }
    const marca = 'Mensagem não suportada'
    const antes = [
      marca,
      `${marca}\n`,
      `${marca}\n  Olá\nTudo bem?`,
      `${marca}\r\nResposta`,
      `Antes\n${marca}\nDepois`,
      null,
    ]
    const inserir = db.prepare(
      "INSERT INTO mensagens(id,conversa_id,numero_id,direcao,tipo,estado,texto,instante) VALUES (?, 'c', 'n', 'recebida', 'texto', 'lida', ?, 1)",
    )
    for (const [i, texto] of antes.entries()) inserir.run(String(i), texto)
    for (const nome of migracoes.filter((nome) => nome.startsWith('0014'))) {
      db.exec(readFileSync(`drizzle/${nome}`, 'utf8'))
    }
    expect(
      db
        .prepare('SELECT texto FROM mensagens ORDER BY id')
        .all()
        .map((linha) => linha.texto),
    ).toEqual([
      marca,
      `${marca}\n`,
      '  Olá\nTudo bem?',
      'Resposta',
      antes[4],
      null,
    ])
  } finally {
    db.close()
  }
})
