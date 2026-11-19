import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EllipsisVertical, QrCode, Settings } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Input } from '#/components/ui/input'
import { conectarNumeroFn, consultarPareamentoFn } from '#/lib/wa-numeros-fns'
import {
  catalogoNumerosQuery,
  invalidarNumeros,
} from '#/lib/wa-numeros-queries'
import { Acao, Janela } from './pecas'
import type { NumeroPainel } from './wa-numeros'

export function Dias({
  valor,
  mudar,
}: {
  valor: number
  mudar: (v: number) => void
}) {
  const id = useId()
  return (
    <div className="grid gap-1">
      <label htmlFor={id}>Dias de histórico</label>
      <Input
        id={id}
        aria-describedby={`${id}-ajuda`}
        type="number"
        min={1}
        max={365}
        value={Number.isNaN(valor) ? '' : valor}
        onChange={(e) => mudar(e.target.valueAsNumber)}
      />
      <small id={`${id}-ajuda`} className="text-[var(--text-2)]">
        De 1 a 90 dias, o pedido é de histórico normal. De 91 a 365, pede o
        histórico completo (na API, 0 equivale a 365).
      </small>
    </div>
  )
}

type Pareamento = Awaited<ReturnType<typeof consultarPareamentoFn>>
export function Conectar({
  numero,
  automatico,
  usuario,
  fechar,
}: {
  numero: NumeroPainel
  automatico: boolean
  usuario: string
  fechar: () => void
}) {
  const [aba, setAba] = useState<'qr' | 'telefone'>('qr')
  const [telefone, setTelefone] = useState(numero.telefone ?? '')
  const [dias, setDias] = useState(numero.diasHistorico)
  const [instanciaId, setInstanciaId] = useState('')
  const catalogo = useQuery({
    ...catalogoNumerosQuery(usuario),
    enabled: numero.precisaVincular,
  })
  const livres = catalogo.data?.filter((i) => !i.adicionada) ?? []
  const [ultimo, setUltimo] = useState<Pareamento | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const ocupado = useRef(false),
    abriu = useRef(false)
  const cache = useQueryClient()
  const estado = useQuery({
    queryKey: ['wa-pareamento', usuario, numero.id],
    queryFn: () => consultarPareamentoFn({ data: numero.id }),
    enabled: ultimo !== null,
    retry: false,
    gcTime: 0,
  })
  const atual = estado.data ?? ultimo
  const iniciar = useCallback(
    async (fone?: string) => {
      if (ocupado.current) return
      ocupado.current = true
      setCarregando(true)
      setErro('')
      try {
        const resultado = await conectarNumeroFn({
          data: {
            id: numero.id,
            dias,
            telefone: fone,
            instanciaId: numero.precisaVincular ? instanciaId : undefined,
          },
        })
        if (!resultado.ok) {
          setErro(resultado.mensagem)
          return
        }
        const p = resultado.valor
        setUltimo(p)
        cache.setQueryData(['wa-pareamento', usuario, numero.id], p)
        await invalidarNumeros(cache)
      } catch {
        setErro('Não foi possível confirmar a conexão. Tente de novo.')
      } finally {
        ocupado.current = false
        setCarregando(false)
      }
    },
    [cache, numero.id, numero.precisaVincular, instanciaId, dias, usuario],
  )
  useEffect(() => {
    if (automatico && !abriu.current) {
      abriu.current = true
      void iniciar()
    }
  }, [automatico, iniciar])
  const diasValidos = Number.isInteger(dias) && dias >= 1 && dias <= 365
  const conectado =
    numero.estado === 'conectado' || atual?.estado === 'conectado'
  const codigo = atual?.codigo
  return (
    <Janela
      titulo={automatico ? 'Conectar número' : `Reconectar ${numero.nome}`}
      onClose={fechar}
    >
      {(erro || estado.isError) && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {erro || 'Não foi possível atualizar o estado do número.'}
        </p>
      )}
      {numero.precisaVincular ? (
        <div className="grid gap-3">
          <p>
            Escolha a instância que corresponde a {numero.nome} neste servidor.
          </p>
          {catalogo.isPending ? (
            <p role="status">Buscando instâncias…</p>
          ) : catalogo.isError ? (
            <div role="alert">
              Não foi possível carregar as instâncias.{' '}
              <Acao onClick={() => catalogo.refetch()}>Tentar de novo</Acao>
            </div>
          ) : livres.length ? (
            <>
              <label className="grid gap-1">
                Instância do servidor
                <select
                  className="select"
                  value={instanciaId}
                  disabled={carregando}
                  onChange={(e) => setInstanciaId(e.target.value)}
                >
                  <option value="">Escolha uma instância</option>
                  {livres.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome}
                    </option>
                  ))}
                </select>
              </label>
              <Acao
                tipo="primary"
                className="justify-self-start"
                disabled={carregando || !instanciaId}
                onClick={() => iniciar()}
              >
                Vincular e reconectar
              </Acao>
            </>
          ) : (
            <p>Nenhuma instância disponível neste servidor.</p>
          )}
        </div>
      ) : conectado ? (
        <div className="grid gap-2">
          <h3>{numero.nome} conectado</h3>
          <p>As mensagens deste número já podem chegar à equipe.</p>
        </div>
      ) : (
        <>
          <div className="seg" role="tablist" aria-label="Forma de conexão">
            {(['qr', 'telefone'] as const).map((k) => (
              <button
                type="button"
                key={k}
                className={aba === k ? 'on' : ''}
                role="tab"
                aria-selected={aba === k}
                onClick={() => setAba(k)}
              >
                {k === 'qr' ? 'QR Code' : 'Conectar com número de telefone'}
              </button>
            ))}
          </div>
          <div className="my-4 max-w-56">
            <Dias valor={dias} mudar={setDias} />
          </div>
          {aba === 'qr' ? (
            <div className="connect">
              <div>
                <h3>Leia o QR Code com o celular do número</h3>
                <ol className="steps">
                  <li>
                    <span>
                      Abra o <b>WhatsApp</b> no celular do {numero.nome}
                    </span>
                  </li>
                  <li>
                    <span>
                      Toque em{' '}
                      <span className="kbd">
                        <EllipsisVertical size={13} />
                        Mais opções
                      </span>{' '}
                      no Android ou em{' '}
                      <span className="kbd">
                        <Settings size={13} />
                        Configurações
                      </span>{' '}
                      no iPhone
                    </span>
                  </li>
                  <li>
                    <span>
                      Toque em <b>Aparelhos conectados</b> ›{' '}
                      <b>Conectar um aparelho</b>
                    </span>
                  </li>
                  <li>
                    <span>Aponte a câmera do celular para o código</span>
                  </li>
                </ol>
              </div>
              <div className="qrwrap">
                {atual?.qr ? (
                  <>
                    <div className="qrbox">
                      <img src={atual.qr} alt="QR Code de conexão" />
                    </div>
                    <div className="qrnote">
                      <span className="status wait">
                        <span className="dot" />
                        Aguardando leitura…
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="grid aspect-square place-items-center gap-3 rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--sunken)] p-6 text-center">
                    <div className="grid justify-items-center gap-3">
                      <QrCode
                        size={40}
                        strokeWidth={1.5}
                        className="text-[var(--text-3)]"
                        aria-hidden="true"
                      />
                      <p className="text-sm text-[var(--text-2)]">
                        O código aparece aqui e vale por alguns segundos.
                      </p>
                      <Acao
                        tipo="primary"
                        disabled={carregando || !diasValidos}
                        onClick={() => iniciar()}
                      >
                        {carregando ? 'Gerando…' : 'Gerar QR Code'}
                      </Acao>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="connect pairmode">
              <div>
                <h3>Conectar com número de telefone</h3>
                <ol className="steps">
                  <li>
                    <span>
                      No celular, abra <b>WhatsApp</b> ›{' '}
                      <b>Aparelhos conectados</b> › <b>Conectar um aparelho</b>
                    </span>
                  </li>
                  <li>
                    <span>
                      Toque em <b>Conectar com número de telefone</b>
                    </span>
                  </li>
                  <li>
                    <span>Digite no celular o código de 8 caracteres</span>
                  </li>
                </ol>
              </div>
              <div>
                <label className="pair-phone" htmlFor="telefone-pareamento">
                  Número do WhatsApp
                  <Input
                    id="telefone-pareamento"
                    type="tel"
                    className="field tnum"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                  />
                </label>
                {codigo ? (
                  <fieldset
                    className="pair"
                    aria-label={`Código de pareamento ${codigo}`}
                  >
                    {Array.from(codigo, (c, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: o código tem oito posições fixas.
                      <span key={`${i}-${c}`} className={i === 4 ? 'next' : ''}>
                        {c}
                      </span>
                    ))}
                  </fieldset>
                ) : (
                  <Acao
                    tipo="primary"
                    className="gerar"
                    disabled={
                      carregando ||
                      !/^\d{10,15}$/.test(telefone.replace(/\D/g, '')) ||
                      !diasValidos
                    }
                    onClick={() => iniciar(telefone.replace(/\D/g, ''))}
                  >
                    Gerar código
                  </Acao>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Janela>
  )
}
