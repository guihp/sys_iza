import { notFound } from 'next/navigation'
import { requireSessao } from '@/auth/session'
import {
  CabecalhoDePagina,
  Cartao,
  EstadoVazio,
  Kpi,
  PilulaLink,
  RotuloMiudo,
  Tabela,
  TabelaCabecalho,
  TabelaCelula,
  TabelaColuna,
  TabelaCorpo,
  TabelaLinha,
  juntar,
} from '@/components/ui'
import { dataDaClinica } from '@/lib/datetime'
import { createServerClient } from '@/lib/supabase/server'
import {
  janelaDoPeriodo,
  periodoDaUrl,
  PERIODOS_EM_DIAS,
  type LinhaDeMarketing,
  type TotaisDeMarketing,
} from './cruzamento'
import { carregarMarketing } from './dados'
import {
  formatarDiaCurto,
  formatarInteiro,
  formatarMoeda,
  formatarMoedaRedonda,
  formatarOrigem,
  formatarRoi,
  formatarTaxa,
  TRACINHO,
} from './formatacao'
import type { EstadoDoDataset } from '@/integrations/meta/marketing-api'

export const metadata = { title: 'Marketing' }

/**
 * O passo a passo do token, para o estado desligado.
 *
 * Mesmo formato da tela do Google Agenda, e pela mesma razão: quem lê é a Dra.,
 * que vai executar isso no Business — então a instrução precisa dizer o caminho
 * do menu, não o nome do escopo da API.
 */
const PASSOS: { titulo: string; detalhe: string }[] = [
  {
    titulo: 'Criar um usuário do sistema no Gerenciador de Negócios',
    detalhe:
      'business.facebook.com → Configurações do Business → Usuários → Usuários do sistema → ' +
      'Adicionar. Um usuário do sistema é uma credencial da empresa, que não expira junto com ' +
      'a senha de ninguém.',
  },
  {
    titulo: 'Dar a ele acesso à conta de anúncios',
    detalhe:
      'No mesmo painel: Atribuir ativos → Contas de anúncios → a conta da clínica → permissão ' +
      'de leitura. Sem este passo o token existe e não enxerga nada.',
  },
  {
    titulo: 'Gerar um token com a permissão ads_read',
    detalhe:
      'Ainda no usuário do sistema: Gerar novo token → escolher o app → marcar ads_read. ' +
      'Só leitura: esta tela não pausa anúncio nem mexe em orçamento, e o token não precisa ' +
      'poder fazer isso.',
  },
  {
    titulo: 'Preencher META_ADS_TOKEN e reiniciar o container',
    detalhe:
      'Pelo painel do Coolify. O token fica só nas variáveis do servidor: ele nunca aparece ' +
      'nesta tela e nunca vai para o navegador.',
  },
]

/**
 * Marketing: o cruzamento entre o gasto da Meta e o desfecho clínico daqui.
 *
 * ---------------------------------------------------------------------------
 * Exclusiva da Dra., e `notFound()` em vez de "acesso negado"
 * ---------------------------------------------------------------------------
 * Mesma regra de `/configuracoes/google`: a secretária não vê o item no menu e
 * não abre a rota. Aqui o argumento é mais forte do que lá — esta tela mostra
 * quanto a clínica gasta, quanto fatura e quanto custa cada paciente. É
 * informação de dona de negócio.
 *
 * ---------------------------------------------------------------------------
 * Somente leitura
 * ---------------------------------------------------------------------------
 * Não há botão que mude nada na Meta, e é decisão do dono registrada no plano.
 * Pausar anúncio e mexer em orçamento continua no Gerenciador.
 *
 * ---------------------------------------------------------------------------
 * Nenhum nome de paciente, nenhum procedimento
 * ---------------------------------------------------------------------------
 * A tabela cruza anúncio com desfecho clínico, e agregado basta. Quem garante
 * isso é o tipo que chega até aqui (`AtribuicaoDoBanco` não tem esses campos),
 * não a atenção de quem edita o arquivo depois.
 */
export default async function PaginaDeMarketing({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string | string[] }>
}) {
  const sessao = await requireSessao()
  if (sessao.role !== 'dra') notFound()

  const { periodo: periodoBruto } = await searchParams
  const dias = periodoDaUrl(periodoBruto)

  // O fuso entra uma vez só: qual é o dia de hoje NA CLÍNICA. Das 21:00 em
  // diante, em Brasília, o servidor em UTC já virou o dia — e uma janela tirada
  // dele pediria à Meta um período que ainda não começou.
  const hojeISO = dataDaClinica(new Date())
  const janela = janelaDoPeriodo(hojeISO, dias)

  const supabase = await createServerClient()
  const estado = await carregarMarketing({ supabase, periodo: janela })

  if (!estado.ligada) {
    return (
      <section className="space-y-6">
        <CabecalhoDePagina
          secao="Aquisição"
          titulo="Marketing"
          descricao="Cruza o gasto dos anúncios da Meta com o que aconteceu aqui dentro: quantas pacientes cada anúncio trouxe, quantas agendaram e quanto custou cada uma. Precisa de um token de leitura da conta de anúncios."
          kpis={
            <>
              <Kpi rotulo="Investido" valor={TRACINHO} sublegenda="sem token" />
              <Kpi rotulo="CAC real" valor={TRACINHO} sublegenda="sem token" />
              <Kpi rotulo="ROI" valor={TRACINHO} sublegenda="sem token" />
            </>
          }
        />

        <Cartao className="space-y-2 p-4">
          <p className="text-[13px]">Leitura de anúncios desligada</p>
          <p className="text-[13px] text-texto-suave">
            Nenhum token da Marketing API está configurado, então o sistema não consulta o gasto
            das campanhas. Todo o resto continua funcionando igual — a atribuição de quem chega
            por anúncio segue sendo gravada, e ela aparece aqui assim que o token existir.
          </p>
        </Cartao>

        <div className="space-y-3">
          <h2 className="font-serif text-lg">Como ligar</h2>
          <ol className="space-y-3">
            {PASSOS.map((passo, indice) => (
              <li key={passo.titulo} className="flex gap-3 text-[13px]">
                <span className="shrink-0 text-texto-suave">{indice + 1}.</span>
                <span>
                  <span className="block">{passo.titulo}</span>
                  <span className="block text-texto-suave">{passo.detalhe}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <Cartao className="space-y-2 p-4">
          <h2 className="font-serif text-lg">O que esta tela vai mostrar</h2>
          <ul className="space-y-1 text-[13px] text-texto-suave">
            <li>
              Gasto, impressões, cliques e conversas iniciadas por anúncio, vindos da Meta.
            </li>
            <li>
              Quantas dessas pessoas viraram lead, agendaram, compareceram e viraram paciente —
              isso só o nosso banco sabe.
            </li>
            <li>
              O CAC real (quanto custou cada paciente) e o ROI (quanto voltou de cada real
              gasto). Nenhum painel da Meta consegue calcular esses dois.
            </li>
            <li>
              O cruzamento depende do fluxo do n8n gravar o anúncio de origem de quem chega pelo
              WhatsApp. Sem ele a tabela mostra o gasto e nenhum desfecho.
            </li>
          </ul>
        </Cartao>
      </section>
    )
  }

  const { linhas, totais } = estado
  const vazia = linhas.length === 0

  return (
    <section className="space-y-6">
      <CabecalhoDePagina
        secao="Aquisição"
        titulo="Marketing"
        descricao="O que a Meta cobrou de um lado e o que aconteceu do outro, anúncio por anúncio. Somente leitura: pausar anúncio e mexer em orçamento continua no Gerenciador."
        kpis={
          <>
            <Kpi
              rotulo="Investido"
              valor={formatarMoedaRedonda(totais.gastoCentavos)}
              sublegenda={`últimos ${dias} dias`}
            />
            <Kpi
              rotulo="CAC real"
              valor={formatarMoedaRedonda(totais.cacCentavos)}
              sublegenda={
                totais.pacientes > 0
                  ? `${formatarInteiro(totais.pacientes)} paciente${totais.pacientes === 1 ? '' : 's'}`
                  : 'nenhuma paciente ainda'
              }
            />
            <Kpi
              rotulo="ROI"
              valor={formatarRoi(totais.roi)}
              sublegenda={
                totais.gastoCentavos > 0
                  ? `${formatarMoedaRedonda(totais.receitaCentavos)} atribuídos`
                  : 'nenhum gasto no período'
              }
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {PERIODOS_EM_DIAS.map((opcao) => {
          const ativo = opcao === dias
          return (
            <PilulaLink
              key={opcao}
              href={`/marketing?periodo=${opcao}`}
              variante={ativo ? 'contorno' : 'suave'}
              className={juntar('min-h-11', ativo ? 'border-acento text-acento' : undefined)}
              aria-current={ativo ? 'page' : undefined}
            >
              {ativo ? (
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
              ) : null}
              {opcao} dias
            </PilulaLink>
          )
        })}
        <span className="text-[11px] text-texto-suave">
          {formatarDiaCurto(estado.periodo.desde)} a {formatarDiaCurto(estado.periodo.ate)}
        </span>
      </div>

      {estado.avisoDaApi ? (
        <Cartao className="space-y-1 p-4">
          <p className="text-[13px]">Não foi possível ler o gasto na Meta</p>
          <p className="text-[13px] text-texto-suave">{estado.avisoDaApi}</p>
          <p className="text-[11px] text-texto-suave">
            As contagens do funil abaixo são do nosso banco e continuam corretas.
          </p>
        </Cartao>
      ) : null}

      {estado.avisoDoBanco ? (
        <Cartao className="space-y-1 p-4">
          <p className="text-[13px]">Não foi possível ler a atribuição das pacientes</p>
          <p className="text-[13px] text-texto-suave">{estado.avisoDoBanco}</p>
        </Cartao>
      ) : null}

      {vazia ? (
        <Cartao className="p-4">
          <EstadoVazio
            mensagem="Nenhum anúncio com gasto ou lead neste período."
            explicacao="As campanhas estão pausadas e ninguém chegou por anúncio ainda. A tabela se preenche sozinha quando um anúncio voltar a rodar e alguém mandar mensagem por ele."
          />
        </Cartao>
      ) : (
        <Cartao className="px-4">
          <Tabela>
            <TabelaCabecalho>
              <TabelaLinha>
                <TabelaColuna>Anúncio</TabelaColuna>
                <TabelaColuna className="text-right">Gasto</TabelaColuna>
                <TabelaColuna className="text-right">Entrega</TabelaColuna>
                <TabelaColuna className="text-right">Conversas</TabelaColuna>
                <TabelaColuna className="text-right">Leads</TabelaColuna>
                <TabelaColuna className="text-right">Agendaram</TabelaColuna>
                <TabelaColuna className="text-right">Compareceram</TabelaColuna>
                <TabelaColuna className="text-right">Pacientes</TabelaColuna>
                <TabelaColuna className="text-right">Receita</TabelaColuna>
                <TabelaColuna className="text-right">CAC real</TabelaColuna>
                <TabelaColuna className="text-right">ROI</TabelaColuna>
              </TabelaLinha>
            </TabelaCabecalho>
            <TabelaCorpo>
              {linhas.map((linha) => (
                <LinhaDoAnuncio key={linha.adId} linha={linha} />
              ))}
              <LinhaDeTotal totais={totais} />
            </TabelaCorpo>
          </Tabela>
        </Cartao>
      )}

      <BlocoDoDataset dataset={estado.dataset} />
    </section>
  )
}

/** Uma célula numérica: número alinhado à direita e, opcionalmente, uma nota. */
function Numero({ valor, nota }: { valor: string; nota?: string | null }) {
  return (
    <TabelaCelula className="text-right whitespace-nowrap">
      <p className="text-[13px]">{valor}</p>
      {nota ? <p className="text-[11px] text-texto-suave">{nota}</p> : null}
    </TabelaCelula>
  )
}

function LinhaDoAnuncio({ linha }: { linha: LinhaDeMarketing }) {
  const origem = formatarOrigem(linha.sourceApp)
  const legenda = [linha.campanha, origem].filter(Boolean).join(' · ')

  return (
    <TabelaLinha>
      <TabelaCelula>
        <p className="font-serif text-[17px] leading-tight">{linha.anuncio}</p>
        {legenda ? <p className="text-[11px] text-texto-suave">{legenda}</p> : null}
      </TabelaCelula>

      <Numero valor={formatarMoeda(linha.gastoCentavos)} />
      <Numero
        valor={formatarInteiro(linha.impressoes)}
        nota={`${formatarInteiro(linha.cliques)} cliques`}
      />
      <Numero
        valor={formatarInteiro(linha.conversas)}
        // Custo por conversa é `null` quando não houve conversa: dividir gasto
        // por zero conversa não dá infinito, dá "não dá para dizer".
        nota={
          linha.custoPorConversaCentavos === null
            ? null
            : `${formatarMoeda(linha.custoPorConversaCentavos)} cada`
        }
      />
      <Numero valor={formatarInteiro(linha.leads)} />
      <Numero
        valor={formatarInteiro(linha.agendaram)}
        nota={
          linha.taxaLeadAgendado === null ? null : `${formatarTaxa(linha.taxaLeadAgendado)} do lead`
        }
      />
      <Numero valor={formatarInteiro(linha.compareceram)} />
      <Numero valor={formatarInteiro(linha.pacientes)} />
      <Numero valor={formatarMoeda(linha.receitaCentavos)} />
      <Numero valor={formatarMoeda(linha.cacCentavos)} />
      <Numero valor={formatarRoi(linha.roi)} />
    </TabelaLinha>
  )
}

function LinhaDeTotal({ totais }: { totais: TotaisDeMarketing }) {
  return (
    <TabelaLinha className="border-t border-linha">
      <TabelaCelula>
        <RotuloMiudo>Total</RotuloMiudo>
      </TabelaCelula>
      <Numero valor={formatarMoeda(totais.gastoCentavos)} />
      <Numero valor={TRACINHO} />
      <Numero valor={formatarInteiro(totais.conversas)} />
      <Numero valor={formatarInteiro(totais.leads)} />
      <Numero valor={formatarInteiro(totais.agendaram)} />
      <Numero valor={formatarInteiro(totais.compareceram)} />
      <Numero valor={formatarInteiro(totais.pacientes)} />
      <Numero valor={formatarMoeda(totais.receitaCentavos)} />
      <Numero valor={formatarMoeda(totais.cacCentavos)} />
      <Numero valor={formatarRoi(totais.roi)} />
    </TabelaLinha>
  )
}

/**
 * Saúde do dataset de conversões.
 *
 * Some inteiro quando a Meta não devolve — ver `interpretarEstadoDoDataset`.
 * É o bloco que dá de cara quando a qualidade de correspondência cai, que é o
 * jeito silencioso de a otimização parar de funcionar.
 */
function BlocoDoDataset({ dataset }: { dataset: EstadoDoDataset | null }) {
  if (!dataset) return null

  const total = dataset.volumePorEvento.reduce((soma, item) => soma + item.quantidade, 0)

  return (
    <Cartao className="space-y-3 p-4">
      <RotuloMiudo tom="acento">Dataset de conversões</RotuloMiudo>

      <div className="flex flex-wrap gap-x-12 gap-y-4">
        <Kpi
          rotulo="Correspondência"
          valor={
            dataset.qualidadeDaCorrespondencia === null
              ? TRACINHO
              : `${dataset.qualidadeDaCorrespondencia.toFixed(1).replace('.', ',')}`
          }
          sublegenda="de 10 — quanto a Meta consegue casar"
        />
        <Kpi
          rotulo="Último evento"
          valor={
            dataset.ultimoEventoEm === null
              ? TRACINHO
              : formatarDiaCurto(dataDaClinica(dataset.ultimoEventoEm))
          }
          sublegenda="frescor do envio"
        />
        <Kpi
          rotulo="Eventos"
          valor={formatarInteiro(total)}
          sublegenda={`${dataset.volumePorEvento.length} tipos`}
        />
      </div>

      {dataset.volumePorEvento.length > 0 ? (
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-texto-suave">
          {dataset.volumePorEvento.map((item) => (
            <li key={item.evento}>
              {item.evento} · {formatarInteiro(item.quantidade)}
            </li>
          ))}
        </ul>
      ) : null}
    </Cartao>
  )
}
