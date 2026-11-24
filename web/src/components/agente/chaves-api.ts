"use client";
// Chaves e configurações de integração (IA, voz, telefonia, Meta). O valor de um SEGREDO nunca volta do servidor;
// configurações comuns (número, URL, provedor) voltam em `value` para aparecer no campo.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "@/lib/client";

export type Chave = {
  name: string;
  label: string;
  group: string;
  hint: string;
  secret?: false;
  options?: string[];
  placeholder?: string;
  value: string | null;
  configured: boolean;
  source: "painel" | "ambiente" | null;
  last4: string | null;
};

export const MSG_CHAVE = { network: "Sem conexão com o servidor. Nada foi salvo.", fallback: "Não foi possível salvar. Tente de novo.", byStatus: { 403: "Só o dono da conta altera isto." } };

export function useChaves(role?: string) {
  return useQuery({
    queryKey: ["config-secrets"],
    enabled: role === "owner" || role === "manager",
    queryFn: ({ signal }) => getJson<Chave[]>("/api/pilot/config/secrets", signal),
  });
}

/** Salva (ou, com valor vazio, remove) uma chave/configuração e atualiza as telas que dependem dela. */
export function useSalvarChave(name: string, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string) => sendJson<Chave[]>("PUT", `/api/pilot/config/secrets/${name}`, { value }, MSG_CHAVE as never),
    onSuccess: (d) => {
      qc.setQueryData(["config-secrets"], d);
      qc.invalidateQueries({ queryKey: ["readiness"] });
      qc.invalidateQueries({ queryKey: ["voz"] });
      onDone?.();
    },
  });
}
