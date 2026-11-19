import { AlertCircle, Check, CheckCheck, Clock, Search, X } from 'lucide-react'
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useState,
} from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import type { MensagemChat } from '#/lib/wa-conversas'

export function Avatar({
  nome,
  tamanho,
  contatoId,
  children,
}: {
  nome: string
  tamanho?: number
  contatoId?: string
  children?: ReactNode
}) {
  const [carregada, setCarregada] = useState<string | null>(null)
  let hash = 0
  for (const letra of nome) hash = (hash * 31 + letra.charCodeAt(0)) >>> 0
  const palavras =
    nome.replace(/^(Dr\.|Dra\.)\s*/i, '').match(/[\p{L}\p{N}]+/gu) ?? []
  const maiusculas = palavras.filter((palavra) => /^\p{Lu}/u.test(palavra))
  const letras =
    (maiusculas.length ? maiusculas : palavras)
      .slice(0, 2)
      .map((palavra) => Array.from(palavra)[0])
      .join('')
      .toLocaleUpperCase('pt-BR') || '?'
  return (
    <span
      aria-hidden="true"
      className={`av av-${hash % 8}`}
      style={tamanho ? ({ '--s': `${tamanho}px` } as CSSProperties) : undefined}
    >
      {contatoId && carregada === contatoId ? null : letras}
      {contatoId && (
        <img
          key={contatoId}
          src={`/api/contatos/${encodeURIComponent(contatoId)}/foto`}
          alt=""
          loading="lazy"
          className="foto-contato"
          style={{ opacity: carregada === contatoId ? 1 : 0 }}
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0) setCarregada(contatoId)
          }}
          onLoad={() => setCarregada(contatoId)}
          onError={() => setCarregada(null)}
        />
      )}
      {children}
    </span>
  )
}
export function MarcaEntrega({ estado }: { estado: MensagemChat['estado'] }) {
  const [Icone, rotulo, classe] = (
    {
      enviada: [Check, 'Enviada', 'sent'],
      entregue: [CheckCheck, 'Entregue', 'del'],
      lida: [CheckCheck, 'Lida', 'read'],
      fila: [Clock, 'Enviando', 'sending'],
      falha: [AlertCircle, 'Falhou', 'fail'],
    } as const
  )[estado]
  return (
    <span role="img" aria-label={rotulo} className={`tick ${classe}`}>
      <Icone size={estado === 'fila' ? 12 : 16} />
    </span>
  )
}
export function Busca({
  value,
  onChange,
  nome,
}: {
  value: string
  onChange: (s: string) => void
  nome: string
}) {
  return (
    <div className="search">
      <Search size={17} />
      <Input
        type="search"
        className="h-[38px] border-0 bg-[var(--surface-2)] pl-[38px] pr-3 dark:bg-[var(--surface-2)]"
        aria-label={nome}
        placeholder="Buscar nome, telefone ou empresa"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
export function Acao({
  className = '',
  tipo = 'ghost',
  ...props
}: ComponentProps<'button'> & {
  tipo?: 'primary' | 'ghost' | 'quiet' | 'warn'
}) {
  return (
    <Button
      type="button"
      variant={tipo === 'primary' ? 'brand' : 'ghost'}
      className={`btn btn-${tipo} ${className} ${className.includes('btn-sm') ? 'h-[30px] gap-1.5 rounded-[7px] px-2.5 py-0 text-[13px] has-[>svg]:px-2.5' : 'px-3.5 py-0 has-[>svg]:px-3.5'} disabled:opacity-80`}
      {...props}
    />
  )
}
export function IconeBotao({
  nome,
  className = '',
  ...props
}: ComponentProps<'button'> & { nome: string }) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={nome}
      title={nome}
      {...props}
    />
  )
}
export function Filtro({
  nome,
  valor,
  onChange,
  todos,
  opcoes,
}: {
  nome: string
  valor: string
  onChange: (s: string) => void
  todos: string
  opcoes: [string, string][]
}) {
  return (
    <select
      className="select"
      aria-label={nome}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{todos}</option>
      {opcoes.map(([id, rotulo]) => (
        <option key={id} value={id}>
          {rotulo}
        </option>
      ))}
    </select>
  )
}
export function Janela({
  titulo,
  onClose,
  children,
  rodape,
  pequena = false,
}: {
  titulo: string
  onClose: () => void
  children: ReactNode
  rodape?: ReactNode
  pequena?: boolean
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={`dialog flex w-full max-w-none flex-col gap-0 border-0 p-0 left-0 top-auto bottom-0 translate-x-0 translate-y-0 sm:max-w-none md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 ${pequena ? 'sm md:max-w-[440px]' : 'md:max-w-[720px]'}`}
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <div className="dlg-head">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogClose asChild>
            <button type="button" className="icon-btn" aria-label="Fechar">
              <X size={20} />
            </button>
          </DialogClose>
        </div>
        <div className="dlg-body">{children}</div>
        <div className="dlg-foot">
          <DialogClose asChild>
            <Acao>Fechar</Acao>
          </DialogClose>
          {rodape}
        </div>
      </DialogContent>
    </Dialog>
  )
}
