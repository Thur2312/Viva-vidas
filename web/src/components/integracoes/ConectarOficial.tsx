"use client";

import { useId, useState } from "react";
import { ActionError } from "@/lib/client";
import { useConnectOfficial } from "./api";

const ERROS: Record<string, string> = {
  chat_nao_configurado: "O chat ainda não está ligado a esta API. Nada foi salvo.",
  chat_indisponivel: "O chat não respondeu agora. Tente de novo em instantes.",
  credenciais_invalidas: "A Meta recusou estas credenciais. Confira o token (permanente, do usuário do sistema) e o Phone Number ID.",
  dados_invalidos: "Confira os campos: Phone Number ID e WABA ID só têm números, e o token é o permanente.",
};

const campo = "min-h-[44px] w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

/** Cadastro da API oficial (Cloud API da Meta). Só o dono. O token não é exibido nem guardado nesta tela depois de enviado. */
export function ConectarOficial({ conectada }: { conectada: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [phone, setPhone] = useState("");
  const [waba, setWaba] = useState("");
  const [token, setToken] = useState("");
  const [nome, setNome] = useState("");
  const m = useConnectOfficial();
  const id = useId();
  const falha = m.isError
    ? m.error instanceof ActionError ? m.error.message : "Não foi possível cadastrar."
    : m.data && !m.data.ok ? ERROS[m.data.error] ?? "Não foi possível cadastrar." : null;
  const feito = m.data?.ok === true;

  if (!aberto) {
    return (
      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-semibold">API oficial do WhatsApp (Meta)</p>
        <p className="mt-1 max-w-xl text-sm text-mute">
          {conectada ? "Já há um número cadastrado. Você pode trocar o token ou o número." : "É o canal para disparos e mensagens ativas: exige número verificado e templates aprovados pela Meta."}
        </p>
        <button type="button" onClick={() => setAberto(true)} className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          {conectada ? "Trocar credenciais" : "Cadastrar API oficial"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="mt-6 max-w-xl border-t border-line pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ phoneNumberId: phone.trim(), wabaId: waba.trim(), accessToken: token.trim(), name: nome.trim() || undefined }, { onSuccess: (r) => { if (r.ok) setToken(""); } });
      }}
    >
      <p className="text-sm font-semibold">API oficial do WhatsApp (Meta)</p>
      <p className="mt-1 text-sm text-mute">Os três dados vêm do painel da Meta (WhatsApp Manager). O token é conferido na Meta antes de salvar e não volta para esta tela.</p>
      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor={`${id}-p`} className="mb-1 block text-xs font-semibold text-mute">Phone Number ID</label>
          <input id={`${id}-p`} className={campo} inputMode="numeric" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-w`} className="mb-1 block text-xs font-semibold text-mute">WABA ID (conta do WhatsApp Business)</label>
          <input id={`${id}-w`} className={campo} inputMode="numeric" autoComplete="off" value={waba} onChange={(e) => setWaba(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-t`} className="mb-1 block text-xs font-semibold text-mute">Token permanente (usuário do sistema)</label>
          <input id={`${id}-t`} className={campo} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-n`} className="mb-1 block text-xs font-semibold text-mute">Nome da conexão (opcional)</label>
          <input id={`${id}-n`} className={campo} maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="WhatsApp Oficial" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={m.isPending || !phone.trim() || !waba.trim() || token.trim().length < 20} className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
          {m.isPending ? "Conferindo na Meta…" : "Salvar e conferir"}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="inline-flex min-h-[44px] items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-ink/5">Fechar</button>
      </div>
      {feito && <p role="status" className="mt-3 text-sm text-ok">Credenciais conferidas e salvas no chat. {m.data && m.data.ok && m.data.data.created ? "Conexão criada." : "Conexão atualizada."}</p>}
      {falha && <p role="alert" className="mt-3 text-sm text-bad">{falha}</p>}
    </form>
  );
}
