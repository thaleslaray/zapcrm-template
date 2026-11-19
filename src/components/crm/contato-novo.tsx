import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { Input } from '#/components/ui/input'
import { executarComandoFn } from '#/lib/carteira-comandos'
import type { ListaCarteira } from '#/lib/carteira-leitura-tipos'
import { invalidarCarteira } from '#/lib/carteira-queries'
import { nomeDoContato, normalizarTelefone } from '#/lib/telefone'
import { enderecoDoContato } from './carteira-pecas'
import { Acao, Janela } from './pecas'

function telefoneCanonico(valor: string | null) {
  if (!valor) return null
  try {
    return normalizarTelefone(valor)
  } catch {
    return null
  }
}

export function ContatoNovo({
  dados,
  fechar,
}: {
  dados: ListaCarteira
  fechar: () => void
}) {
  const [id] = useState(() => crypto.randomUUID())
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [numeroId, setNumeroId] = useState(dados.numeros[0]?.id ?? '')
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')
  const [conflitoId, setConflitoId] = useState('')
  const ocupado = useRef(false)
  const cache = useQueryClient()
  const numero = dados.numeros.find((n) => n.id === numeroId)
  const canonico = telefoneCanonico(telefone)
  const duplicado = canonico
    ? dados.contatos.find(
        (c) => c.id !== id && telefoneCanonico(c.telefone) === canonico,
      )
    : undefined
  const existenteId = duplicado?.id || conflitoId
  async function salvar(evento: React.FormEvent) {
    evento.preventDefault()
    if (ocupado.current || existenteId || !numero) return
    ocupado.current = true
    setGravando(true)
    setErro('')
    try {
      const resultado = await executarComandoFn({
        data: { tipo: 'criarContato', id, nome, telefone, numeroId },
      })
      if (!resultado.ok) {
        if (resultado.existenteId) setConflitoId(resultado.existenteId)
        else setErro(resultado.mensagem)
        return
      }
      await invalidarCarteira(cache)
      window.location.assign(
        enderecoDoContato(resultado.contatoId, {
          conversa: resultado.conversaId,
          funil: numero.funilPadraoId,
        }),
      )
    } catch {
      setErro('Não foi possível confirmar o cadastro. Tente salvar novamente.')
    } finally {
      ocupado.current = false
      setGravando(false)
    }
  }

  return (
    <Janela
      titulo="Novo contato"
      pequena
      onClose={() => {
        if (!ocupado.current) fechar()
      }}
      rodape={
        <Acao
          tipo="primary"
          type="submit"
          form="novo-contato-form"
          disabled={!!existenteId || gravando || !numeroId}
        >
          {gravando ? 'Salvando…' : 'Salvar e abrir conversa'}
        </Acao>
      }
    >
      <form className="formgrid" id="novo-contato-form" onSubmit={salvar}>
        <label htmlFor="novo-nome">
          Nome
          <Input
            id="novo-nome"
            className="field"
            placeholder="Ex.: Ana Ribeiro"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            maxLength={150}
            disabled={gravando}
          />
        </label>
        <div>
          <label htmlFor="novo-telefone">
            Telefone
            <Input
              id="novo-telefone"
              type="tel"
              className={`field tnum${existenteId ? ' bad' : ''}`}
              placeholder="+55 11 9…"
              value={telefone}
              onChange={(e) => {
                setTelefone(e.target.value)
                setConflitoId('')
                setErro('')
              }}
              required
              maxLength={32}
              disabled={gravando}
              aria-describedby={existenteId ? 'contato-repetido' : undefined}
              aria-invalid={!!existenteId}
            />
          </label>
          {existenteId && (
            <div id="contato-repetido" className="dupwarn" role="alert">
              <CircleAlert size={15} />
              <span>
                {duplicado ? (
                  <>
                    Este telefone já é de <b>{nomeDoContato(duplicado)}</b>
                    {duplicado.telefone?.replace(/\D/g, '') !==
                      telefone.replace(/\D/g, '') &&
                      ' (o mesmo número, com ou sem o nono dígito)'}
                    .
                  </>
                ) : (
                  'Este telefone já está cadastrado.'
                )}
              </span>
              <a
                className="font-semibold underline"
                href={enderecoDoContato(existenteId, { painel: true })}
              >
                Abrir contato
              </a>
            </div>
          )}
        </div>
        <fieldset disabled={gravando}>
          <legend className="mb-1.5 text-[13px] font-medium text-[var(--text-2)]">
            Número da empresa
          </legend>
          <div className="radios flex-wrap">
            {dados.numeros.map((n) => (
              <label key={n.id}>
                <input
                  name="novo-numero"
                  type="radio"
                  value={n.id}
                  checked={numeroId === n.id}
                  onChange={() => setNumeroId(n.id)}
                />
                <span>
                  {n.nome}
                  <small className="muted tnum block">
                    {n.telefone && `${n.telefone} · `}Funil{' '}
                    {dados.funis.find((f) => f.id === n.funilPadraoId)?.nome}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {!dados.numeros.length && (
            <p className="muted">
              {dados.gestor
                ? 'Conecte um número do WhatsApp para começar.'
                : 'Peça ao gestor para conectar um número.'}
            </p>
          )}
        </fieldset>
        {erro && (
          <p className="dupwarn" role="alert">
            {erro}
          </p>
        )}
      </form>
    </Janela>
  )
}
