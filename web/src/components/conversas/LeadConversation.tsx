"use client";

import { Skeleton, EmptyState, ErrorState } from "../Block";
import { useConversations } from "@/lib/hooks";
import { ConversationThread } from "./Thread";

/** Conversa do lead dentro da gaveta do funil: mesma thread (rascunhos, envio, atualização a cada 15 s) da página /conversas. */
export function LeadConversation({ leadId }: { leadId: string }) {
  const q = useConversations({ leadId }, { poll: false });
  const first = q.data?.pages[0]?.data[0];
  if (q.isPending) return <div className="p-5"><Skeleton className="h-48" /></div>;
  if (q.isError && !first) return <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} compact /></div>;
  if (!first) return <div className="p-5"><EmptyState title="Sem conversa registrada">Este lead ainda não trocou mensagens.</EmptyState></div>;
  return <ConversationThread key={first.id} conversationId={first.id} />;
}
