import {
  ArrowLeft,
  Kanban,
  Layers,
  Plus,
  Smartphone,
  Tag,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Etiquetas, Respostas } from './config-catalogos'
import { Equipe } from './config-equipe'
import { FunisEtapas, Setores } from './config-estrutura'
import { Acao } from './pecas'
import { AcaoConectarNumero, Numeros } from './wa-numeros'

const secoes = [
  [
    'numeros',
    'Números do WhatsApp',
    Smartphone,
    'Cada número pertence a um setor. Conversa nova abre um negócio na primeira etapa do funil padrão do número.',
    'Conectar número',
  ],
  [
    'setores',
    'Setores',
    Layers,
    'Cada setor tem os seus números, o seu funil e as suas pessoas. Quem está no setor vê as conversas e os negócios dele.',
    'Novo setor',
  ],
  [
    'equipe',
    'Equipe',
    Users,
    'Gestores veem todos os setores. As outras pessoas veem só os setores em que estão.',
    'Convidar',
  ],
  [
    'funis',
    'Funis e etapas',
    Kanban,
    'Cada funil tem etapas livres. Marque até duas como fechamento: uma de sucesso e uma de perda.',
    'Novo funil',
  ],
  [
    'etiquetas',
    'Etiquetas',
    Tag,
    'Classifique contatos para filtrar a lista e o funil.',
    'Nova etiqueta',
  ],
  [
    'respostas',
    'Respostas rápidas',
    Zap,
    'Digite / na barra de mensagem para usar.',
    'Nova resposta',
  ],
] as const
export function Configuracoes({
  secao,
  funil,
}: {
  secao?: string
  funil?: string
}) {
  const [abrirCatalogo, setAbrirCatalogo] = useState(false)
  const [id, titulo, , descricao, acao] =
    secoes.find(([s]) => s === secao) ?? secoes[0]
  return (
    <div className="cfg">
      <nav className="cfg-nav" aria-label="Seções de configurações">
        <h1>Configurações</h1>
        {secoes.map(([k, n, Icone]) => (
          <a
            href={`/app/configuracoes?secao=${k}`}
            className={k === id ? 'on' : ''}
            aria-current={k === id ? 'page' : undefined}
            key={k}
          >
            <Icone size={18} />
            {n}
          </a>
        ))}
      </nav>
      <div className="cfg-main">
        <div className="cfg-inner">
          <div className="hd">
            <a
              href="/app/mais"
              className="icon-btn cfg-back"
              aria-label="Voltar"
            >
              <ArrowLeft size={22} />
            </a>
            <div>
              <h2>{titulo}</h2>
              <p>{descricao}</p>
            </div>
            {id === 'numeros' ? (
              <AcaoConectarNumero abrir={() => setAbrirCatalogo(true)} />
            ) : (
              <Acao
                tipo={id === 'funis' ? 'ghost' : 'primary'}
                onClick={() => setAbrirCatalogo(true)}
              >
                {id === 'equipe' ? <UserPlus size={17} /> : <Plus size={17} />}{' '}
                {acao}
              </Acao>
            )}
          </div>
          {id === 'numeros' && (
            <Numeros
              abrirCatalogo={abrirCatalogo}
              pedirCatalogo={() => setAbrirCatalogo(true)}
              fecharCatalogo={() => setAbrirCatalogo(false)}
            />
          )}
          {id === 'setores' && (
            <Setores
              criando={abrirCatalogo}
              fechar={() => setAbrirCatalogo(false)}
            />
          )}
          {id === 'equipe' && (
            <Equipe
              criando={abrirCatalogo}
              fechar={() => setAbrirCatalogo(false)}
            />
          )}
          {id === 'funis' && (
            <FunisEtapas
              inicial={funil}
              criando={abrirCatalogo}
              fechar={() => setAbrirCatalogo(false)}
            />
          )}
          {id === 'etiquetas' && (
            <Etiquetas
              criando={abrirCatalogo}
              fechar={() => setAbrirCatalogo(false)}
            />
          )}
          {id === 'respostas' && (
            <Respostas
              criando={abrirCatalogo}
              fechar={() => setAbrirCatalogo(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
