export interface FiltrosContatos {
  busca?: string
  etapaId?: string
  etiquetaId?: string
  responsavelId?: string
  ordem?: 'valor' | 'ultima'
  direcao?: 'asc' | 'desc'
}
export interface FiltrosQuadro {
  funilId?: string
  responsavelId?: string
  numeroId?: string
}
export interface AlvoPainel {
  contatoId?: string
  conversaId?: string
  funilId?: string
}
export interface Marca {
  id: string
  nome: string
  cor: string
}
export interface FunilCarteira extends Marca {
  setorId: string
}
export interface EtapaCarteira extends Marca {
  funilId: string
  posicao: number
  fechamento: 'sucesso' | 'perda' | null
}
export interface NumeroCarteira extends Marca {
  setorId: string
  funilPadraoId: string
  telefone: string | null
}
export interface PessoaCarteira {
  id: string
  nome: string
  setorIds: string[]
  papel: 'gestor' | 'vendedor'
}
export interface CatalogoCarteira {
  gestor: boolean
  funis: FunilCarteira[]
  etapas: EtapaCarteira[]
  numeros: NumeroCarteira[]
  pessoas: PessoaCarteira[]
  etiquetas: Marca[]
}
export interface ConversaCarteira {
  id: string
  numeroId: string
  ultimaMensagemEm: number | null
}
export interface RetornoCarteira {
  id: string
  numeroId: string
  marcadoPara: number
  motivo: string
}
export interface ResumoNegocio {
  chave: string
  funilNome: string
  funilCor: string
  etapaNome: string
  etapaCor: string
  responsavelNome: string | null
  valorCentavos: number | null
  fechadoEm: number | null
  fechamento: 'sucesso' | 'perda' | null
}
export interface NegocioCarteira extends ResumoNegocio {
  id: string
  contatoId: string
  funilId: string
  etapaId: string
  numeroId: string | null
  responsavelId: string | null
  criadoEm: number
  origem: {
    fechadoEm: number | null
    responsavelNome: string | null
    valorCentavos: number | null
  } | null
}
export interface IdentidadeContato {
  telefoneNormalizado: string | null
  id: string
  nome: string
  empresa: string | null
  telefone: string | null
}
export interface ContatoCarteira extends IdentidadeContato {
  etiquetas: Marca[]
  abertos: NegocioCarteira[]
  valorCentavos: number
  responsavelNome: string | null
  conversa: ConversaCarteira | null
}
export interface ListaCarteira extends CatalogoCarteira {
  contatos: ContatoCarteira[]
}
export interface CartaoCarteira extends NegocioCarteira {
  contato: IdentidadeContato
  etiquetas: Marca[]
  retorno: RetornoCarteira | null
  conversa: ConversaCarteira | null
}
export interface QuadroCarteira extends CatalogoCarteira {
  funil: FunilCarteira | null
  cartoes: CartaoCarteira[]
}
export interface PainelCarteira extends CatalogoCarteira {
  conversaAtivaId: string | null
  contato: IdentidadeContato
  etiquetasContato: Marca[]
  conversas: ConversaCarteira[]
  principal: NegocioCarteira | null
  outros: ResumoNegocio[]
  historico: ResumoNegocio[]
  retorno: RetornoCarteira | null
  notas: {
    id: string
    texto: string
    autorNome: string | null
    criadoEm: number
  }[]
  totalNegocios: number
}
