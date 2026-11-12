"use client";

import { QueryClient, QueryClientProvider, keepPreviousData } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import { shouldRetry } from "@/lib/hooks";

// "Ocultar dados sensíveis": padrão LIGADO. Desfoca corpo de mensagens e prévias.
// É proteção contra olhares ao redor, não controle de acesso (o texto continua no DOM).
const PrivacyCtx = createContext<{ hide: boolean; setHide: (v: boolean) => void }>({ hide: true, setHide: () => {} });
export const usePrivacy = () => useContext(PrivacyCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60_000,
            retry: shouldRetry,
            placeholderData: keepPreviousData,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [hide, setHide] = useState(true);
  return (
    <QueryClientProvider client={client}>
      <PrivacyCtx.Provider value={{ hide, setHide }}>{children}</PrivacyCtx.Provider>
    </QueryClientProvider>
  );
}
