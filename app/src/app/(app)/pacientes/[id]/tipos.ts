/**
 * Tipos da ficha — fora de `'use server'`.
 */

export type PacienteCadastro = {
  id: string
  nome_completo: string
  como_prefere_ser_chamado: string | null
  nascimento: string | null
  sexo: string | null
  telefone: string | null
  cpf: string | null
  nacionalidade: string | null
  naturalidade: string | null
  email: string | null
  endereco: string | null
  lead_source: string | null
  procedimento_interesse_id: string | null
  contato_emergencia_nome: string | null
  contato_emergencia_parentesco: string | null
  contato_emergencia_telefone: string | null
  profissao: string | null
  observacoes: string | null
  stage: string
  aceita_whatsapp: boolean
  aceita_email: boolean
}

/** Opção do select de procedimento de interesse no cadastro. */
export type OpcaoProcedimentoInteresse = {
  id: string
  nome: string
}

export type ResultadoDaAcao = { ok: true } | { ok: false; erro: string }

/** Resultado de salvar plano — devolve o id para o editor permanecer aberto. */
export type ResultadoSalvarPlano =
  | { ok: true; id: string }
  | { ok: false; erro: string }

/** Procedimento do catálogo usado na calculadora dos planos. */
export type ProcedimentoDoPlano = {
  id: string
  nome: string
  preco_centavos: number
  categoria: string | null
}

/** Traço serializado do canvas de anotação (coordenadas 0–1). */
export type PontoAnotacao = { x: number; y: number }

export type TracoAnotacao = {
  pontos: PontoAnotacao[]
  cor: string
  espessura: number
  ferramenta: 'caneta' | 'borracha'
}

export type AnotacaoPlano = {
  versao: 1
  tracos: TracoAnotacao[]
}

export type TipoPlano = 'toxina' | 'preenchimento'

export type AnamneseLinha = {
  id: string
  queixa_principal: string | null
  autoconfianca_rosto: string | null
  incomodo_rosto: string | null
  rosto_cansado: boolean | null
  prev_botox: boolean
  prev_acido_hialuronico: boolean
  prev_bioestimulador: boolean
  prev_fios: boolean
  prev_pmma: boolean
  prev_cirurgia: boolean
  prev_outros: boolean
  prev_outros_texto: string | null
  ultimo_procedimento: string | null
  ultimo_procedimento_regiao: string | null
  tratamento_medico_atual: string | null
  medicacao_continua: string | null
  alergias: string | null
  doenca_diabetes: boolean
  doenca_hipertensao: boolean
  doenca_cardiaca: boolean
  doenca_autoimune: boolean
  doenca_tireoide: boolean
  doenca_hepatica: boolean
  doenca_renal: boolean
  doenca_coagulacao: boolean
  doenca_osteoporose: boolean
  doenca_asma_bronquite: boolean
  doenca_epilepsia: boolean
  doenca_cancer: boolean
  doenca_outra: boolean
  doenca_outra_texto: string | null
  gestacao_amamentacao: string | null
  fuma: boolean | null
  alcool_frequente: boolean | null
  ingere_agua: string | null
  exercicios_fisicos: string | null
  boa_alimentacao: string | null
  sono: string | null
  pele_declarada: string | null
  incomoda_flacidez: boolean
  incomoda_linhas: boolean
  incomoda_manchas: boolean
  incomoda_poros: boolean
  incomoda_falta_vico: boolean
  incomoda_outro: boolean
  incomoda_outro_texto: string | null
  protetor_solar_diario: boolean | null
  acidos_cosmeticos: string | null
  roacutan_retinoides: boolean | null
  reacao_cosmeticos_procedimentos: boolean | null
  reacao_detalhe: string | null
  medico_assistente_nome: string | null
  medico_assistente_telefone: string | null
}

export type AvaliacaoLinha = {
  id: string
  pig_melasma_manchas: boolean
  pig_hipopigmentacao: boolean
  pig_sardas: boolean
  vas_eritema: boolean
  vas_telangiectasias: boolean
  vas_hematoma: boolean
  les_acne: boolean
  les_comedoes: boolean
  les_verrugas: boolean
  les_nodulos: boolean
  les_feridas_ulceras: boolean
  les_descamacao: boolean
  cic_atrofica: boolean
  cic_hipertrofica: boolean
  cic_queloide: boolean
  biotipo: string | null
  hidratacao: string | null
  espessura: string | null
  fototipo: string | null
  cor_pele: string | null
  textura_lisa: boolean
  textura_aspera: boolean
  textura_flacida: boolean
  textura_rugas_finas: boolean
  acne: string | null
  glogau: string | null
  rugas_dinamicas: boolean
  rugas_estaticas: boolean
  rugas_superficiais: boolean
  rugas_profundas: boolean
  estado_geral: string | null
  peso_kg: number | null
  altura_m: number | null
  fc_bpm: number | null
  pa_mmhg: string | null
  ritmo_respiratorio: string | null
  marcha: string | null
  musculos_mastigacao: string | null
}

export type ItemBotox = {
  id?: string
  musculo: string
  diluicao_seringa: string | null
  quantidade_unidades: number | null
  total_unidades: number | null
  procedimento_id: string | null
  ordem: number
}

export type PlanoBotox = {
  id: string
  realizado_em: string
  produto_nome: string | null
  validade: string | null
  lote: string | null
  marca: string | null
  anotacao_json: AnotacaoPlano | null
  itens: ItemBotox[]
}

export type ItemFiller = {
  id?: string
  produto: string
  regiao: string | null
  camada: string | null
  tecnica: string | null
  quantidade_ml: number | null
  procedimento_id: string | null
  ordem: number
}

export type PlanoFiller = {
  id: string
  realizado_em: string
  produto_nome: string | null
  validade: string | null
  lote: string | null
  marca: string | null
  anotacao_json: AnotacaoPlano | null
  itens: ItemFiller[]
}

export type FotoLinha = {
  id: string
  angulo: string
  storage_path: string
  mime_type: string | null
  criado_em: string
  urlAssinada: string | null
}

export type ArquivoLinha = {
  id: string
  titulo: string
  categoria: string
  storage_path: string
  mime_type: string | null
  criado_em: string
  urlAssinada: string | null
}
