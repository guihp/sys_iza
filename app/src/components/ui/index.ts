/**
 * Primitivas do sistema visual.
 *
 * Toda tela consome daqui — estilo solto repetido em página é justamente o que
 * este módulo existe para evitar. Importe pelo barril:
 * `import { Cartao, Pilula } from '@/components/ui'`.
 *
 * Nenhum arquivo desta pasta é `'use client'`: são todos componentes de
 * servidor, sem estado e sem evento. Isso é de propósito — assim eles podem ser
 * usados tanto num Server Component quanto dentro de um componente de cliente.
 */

export { Avatar } from './avatar'
export { CabecalhoDePagina } from './cabecalho-de-pagina'
export { Cartao, CLASSES_CARTAO } from './cartao'
export { juntar } from './classes'
export { EstadoVazio } from './estado-vazio'
export { StatusAutosave } from './status-autosave'
export { iniciaisDoNome } from './iniciais'
export { Kpi, LinhaDeKpis } from './kpi'
export {
  Pilula,
  PilulaLink,
  PilulaTexto,
  classesDePilula,
  type VarianteDePilula,
} from './pilula'
export { RotuloMiudo, classesDeRotuloMiudo, type TomDoRotulo } from './rotulo-miudo'
export {
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
} from './tabela'
