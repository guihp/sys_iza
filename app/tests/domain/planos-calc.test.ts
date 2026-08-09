import { describe, expect, it } from 'vitest'
import {
  centavosLinhaFiller,
  centavosLinhaToxina,
  linhaBotoxTemConteudo,
  linhaFillerTemConteudo,
  parseQuantidade,
  serializarItemBotox,
  serializarItemFiller,
  limparRotuloHerdadoDoCatalogo,
  somarCentavos,
} from '@/domain/clinical/planos-calc'

describe('parseQuantidade', () => {
  it('aceita número e string com vírgula decimal', () => {
    expect(parseQuantidade(2.5)).toBe(2.5)
    expect(parseQuantidade('2,5')).toBe(2.5)
    expect(parseQuantidade('10')).toBe(10)
    expect(parseQuantidade('1.5')).toBe(1.5)
    expect(parseQuantidade('1.500,25')).toBe(1500.25)
  })

  it('trata vazio, negativo e inválido como ausência', () => {
    expect(parseQuantidade(null)).toBeNull()
    expect(parseQuantidade('')).toBeNull()
    expect(parseQuantidade('-1')).toBeNull()
    expect(parseQuantidade('abc')).toBeNull()
    expect(parseQuantidade(-3)).toBeNull()
  })
})

describe('linha*TemConteudo + serializar', () => {
  const catalogo = [{ id: '11111111-1111-1111-1111-111111111111', nome: 'Toxina 50U' }]

  it('considera procedimento + quantidade mesmo sem músculo/produto', () => {
    expect(
      linhaBotoxTemConteudo({
        musculo: '',
        diluicao_seringa: '',
        quantidade_unidades: '20',
        total_unidades: '',
        procedimento_id: catalogo[0]!.id,
      }),
    ).toBe(true)
    expect(
      linhaFillerTemConteudo({
        produto: '',
        regiao: '',
        camada: '',
        tecnica: '',
        quantidade_ml: '1,2',
        procedimento_id: catalogo[0]!.id,
      }),
    ).toBe(true)
    expect(
      linhaBotoxTemConteudo({
        musculo: '',
        diluicao_seringa: '',
        quantidade_unidades: '',
        total_unidades: '',
        procedimento_id: '',
      }),
    ).toBe(false)
  })

  it('serializa músculo/produto vazios sem copiar o nome do catálogo', () => {
    const botox = serializarItemBotox(
      {
        musculo: '',
        diluicao_seringa: '',
        quantidade_unidades: '20',
        total_unidades: '',
        procedimento_id: catalogo[0]!.id,
      },
      0,
    )
    expect(botox.musculo).toBe('')
    expect(botox.quantidade_unidades).toBe(20)
    expect(botox.procedimento_id).toBe(catalogo[0]!.id)

    const filler = serializarItemFiller(
      {
        produto: '',
        regiao: 'malar',
        camada: '',
        tecnica: '',
        quantidade_ml: '0,8',
        procedimento_id: catalogo[0]!.id,
      },
      1,
    )
    expect(filler.produto).toBe('')
    expect(filler.quantidade_ml).toBe(0.8)
    expect(filler.ordem).toBe(1)
  })

  it('limpa rótulo herdado do catálogo na UI', () => {
    expect(
      limparRotuloHerdadoDoCatalogo('Toxina 50U', catalogo[0]!.id, catalogo),
    ).toBe('')
    expect(
      limparRotuloHerdadoDoCatalogo('masseter', catalogo[0]!.id, catalogo),
    ).toBe('masseter')
  })
})

describe('centavosLinhaToxina', () => {
  it('multiplica unidades pelo preço R$/U em centavos', () => {
    // 20 U × R$ 15,00/U = R$ 300,00
    expect(centavosLinhaToxina(20, 1500)).toBe(30_000)
    expect(centavosLinhaToxina(2.5, 1500)).toBe(3750)
  })

  it('zera quando falta quantidade ou preço', () => {
    expect(centavosLinhaToxina(null, 1500)).toBe(0)
    expect(centavosLinhaToxina(10, null)).toBe(0)
    expect(centavosLinhaToxina(0, 1500)).toBe(0)
  })
})

describe('centavosLinhaFiller', () => {
  it('multiplica ml pelo preço R$/mL em centavos', () => {
    // 1,2 mL × R$ 800,00/mL = R$ 960,00
    expect(centavosLinhaFiller(1.2, 80_000)).toBe(96_000)
    expect(centavosLinhaFiller(0.5, 80_000)).toBe(40_000)
  })

  it('zera quando falta ml ou preço', () => {
    expect(centavosLinhaFiller(null, 80_000)).toBe(0)
    expect(centavosLinhaFiller(1, null)).toBe(0)
  })
})

describe('somarCentavos', () => {
  it('soma linhas e ignora inválidos', () => {
    expect(somarCentavos([30_000, 3750, -1, NaN])).toBe(33_750)
    expect(somarCentavos([])).toBe(0)
  })
})
