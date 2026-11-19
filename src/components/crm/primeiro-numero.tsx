import { MessageCircle, QrCode } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo } from '#/components/logo'
export function PrimeiroNumero({
  gestor,
  avisos,
}: {
  gestor: boolean
  avisos: ReactNode
}) {
  const titulo = gestor
    ? 'Conecte um número do WhatsApp para começar'
    : 'Peça ao gestor para conectar um número'
  const conectar = gestor && (
    <a className="btn btn-primary" href="/app/configuracoes?secao=numeros">
      <QrCode size={18} />
      Conectar número
    </a>
  )
  return (
    <div className="conv show-list">
      <section className="list-col">
        {avisos}
        <div className="list-head">
          <h1>Conversas</h1>
        </div>
        <div className="empty-list">
          <MessageCircle size={32} />
          <p>Nenhuma conversa ainda.</p>
          <p>{titulo}</p>
          {conectar}
        </div>
      </section>
      <section className="chat-col">
        <div className="welcome">
          <div className="card">
            <Logo className="size-14" />
            <h2>{titulo}</h2>
            <p>
              As conversas dos seus clientes aparecem aqui assim que o primeiro
              número estiver conectado.
            </p>
            {gestor && (
              <ol>
                <li>
                  Abra <b>Configurações › Números do WhatsApp</b>
                </li>
                <li>Leia o QR Code com o celular do número</li>
                <li>Acompanhe as conversas recebidas aqui</li>
              </ol>
            )}
            {conectar}
          </div>
        </div>
      </section>
    </div>
  )
}
