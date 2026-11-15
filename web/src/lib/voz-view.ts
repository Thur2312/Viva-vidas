import type { Estado } from "./agente-estados";
import { diasLegivel } from "./integracoes-view";

// Lógica pura da tela Voz: por que não dá para ligar, o que a manchete afirma e o checklist de conformidade.
// Regra: só se afirma "em ordem" o que foi LIDO do servidor. Regras que o servidor apenas aplica aparecem como "regra", sem selo de estado.

type Provedor = { provider?: string; configured: boolean; ready: boolean; missing: string[] };

/** O que a tela usa de /voice/status (estrutural: o VoiceStatus do voz-api é compatível). */
export type StatusVoz = {
  telephony: Provedor;
  recording: { announcementConfigured: boolean; announcementVersion?: string | null; retentionDays?: number; retentionPendingClientConfirmation?: boolean };
  dnc: { enabled: boolean; configured: boolean; blocking?: boolean };
  callWindow: { days: number[]; start: string; end: string; tz: string; source?: string };
  canPlaceCalls?: boolean;
};

/** Por que o botão Ligar está indisponível, em linguagem direta. null = nada impede. */
export function motivoBloqueio(s: StatusVoz, gestor: boolean): string | null {
  if (!gestor) return "Só gestores podem ligar.";
  if (!s.telephony.ready) return "A telefonia ainda não está configurada (veja o que falta em Estado da integração).";
  if (!s.recording.announcementConfigured) return "Falta o texto do aviso de gravação.";
  if (s.dnc.enabled && !s.dnc.configured) return "Não Perturbe está ligado, mas não há verificador configurado.";
  if (s.canPlaceCalls === false) return "Alguma condição de conformidade não está atendida.";
  return null;
}

/** A manchete da página responde "posso ligar agora?". */
export function manchete(s: StatusVoz, gestor: boolean): { valor: "Pronta" | "Indisponível"; motivo: string | null } {
  const motivo = motivoBloqueio(s, gestor);
  return { valor: motivo ? "Indisponível" : "Pronta", motivo };
}

export function estadoAviso(r: StatusVoz["recording"]): Estado {
  return r.announcementConfigured
    ? { tom: "ok", rotulo: "Configurado", detalhe: r.announcementVersion ? `versão ${r.announcementVersion}` : undefined }
    : { tom: "warn", rotulo: "Falta configurar", detalhe: "Sem o texto, nenhuma ligação é feita" };
}

export type TomConf = "ok" | "warn" | "bad" | "regra";
export type ItemConformidade = { chave: string; titulo: string; tom: TomConf; rotulo: string; texto: string };

const FONTE: Record<string, string> = { painel: "configuração do painel", ambiente: "variável de ambiente" };

/** Checklist do que o servidor APLICA antes de cada ligação (todos os portões falham fechado). */
export function itensConformidade(s: StatusVoz): ItemConformidade[] {
  const w = s.callWindow;
  const r = s.recording;
  const dncTom: TomConf = !s.dnc.enabled ? "warn" : s.dnc.configured ? "ok" : "bad";
  const dias = r.retentionDays;
  const pend = !!r.retentionPendingClientConfirmation;
  return [
    {
      chave: "aviso", titulo: "Aviso de gravação",
      tom: r.announcementConfigured ? "ok" : "bad",
      rotulo: r.announcementConfigured ? "em ordem" : "bloqueia ligações",
      texto: r.announcementConfigured
        ? "Tocado ao lead assim que ele atende. A gravação só é guardada se o aviso foi entregue."
        : "Texto não configurado: sem aviso, não há ligação nem gravação.",
    },
    {
      // NÃO é um estado lido: é uma regra que o servidor aplica lead a lead. Por isso "regra", e não "em ordem".
      chave: "consentimento", titulo: "Consentimento e contato permitido",
      tom: "regra", rotulo: "regra aplicada pelo servidor",
      texto: "Conferidos lead a lead no momento da ligação: precisa existir consentimento ativo para atendimento, sem pedido de não contato.",
    },
    {
      chave: "janela", titulo: "Janela de horário",
      tom: "warn", rotulo: "confirmar com o jurídico",
      texto: `${diasLegivel(w.days)}, ${w.start} às ${w.end} (${w.tz})${w.source ? `, definida por ${FONTE[w.source] ?? "padrão do sistema"}` : ""}. As regras da Anatel para ligações de oferta e o prefixo de identificação do número precisam de confirmação jurídica/de telecom.`,
    },
    {
      chave: "dnc", titulo: "Não Perturbe",
      tom: dncTom,
      rotulo: dncTom === "ok" ? "em ordem" : dncTom === "bad" ? "bloqueia ligações" : "pendente",
      texto: !s.dnc.enabled
        ? "Checagem desligada. Defina a política com o jurídico antes de ligar em escala."
        : s.dnc.configured
          ? "Checagem ligada, com verificador configurado."
          : "Checagem ligada, mas sem verificador configurado: toda ligação é recusada até existir um.",
    },
    {
      chave: "retencao", titulo: "Retenção das gravações",
      tom: dias && !pend ? "ok" : "warn",
      rotulo: !dias ? "pendente" : pend ? "confirmar com o cliente" : "configurada",
      texto: `${dias ? `${dias} dias, depois a gravação é apagada no provedor.` : "Prazo não informado pelo servidor."}${pend ? " O prazo de 1 ano vem do briefing da SUSEP e precisa ser confirmado pelo cliente." : ""}`,
    },
  ];
}
