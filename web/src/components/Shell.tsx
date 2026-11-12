"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, Bot, Plug, Scale, ChevronDown, Kanban, LayoutDashboard, LogOut, Megaphone, Menu, MessageSquare, Moon, PanelLeft, Phone, Send, Sun, X,
} from "lucide-react";
import { Ecg, Wordmark } from "./Brand";
import { brand } from "@/lib/brand";
import { TopProgress } from "./Block";
import { useMe } from "@/lib/hooks";
import { DEMO } from "@/lib/flags";

type Item = { title: string; icon: React.ElementType; path?: string; modules?: { title: string; path: string; icon: React.ElementType }[] };
type Category = { category: string; items: Item[] };

// Mesma estrutura do HDM: categorias, itens e submódulos expansíveis.
const nav: Category[] = [
  {
    category: "Operação",
    items: [
      {
        title: "Dashboard",
        icon: LayoutDashboard,
        path: "/dashboard",
        modules: [
          { title: "Visão geral", path: "/dashboard", icon: BarChart3 },
          { title: "Funil", path: "/funil", icon: Kanban },
        ],
      },
      { title: "Decisão do piloto", icon: Scale, path: "/decisao" },
    ],
  },
  {
    category: "Atendimento",
    items: [
      { title: "Conversas", icon: MessageSquare, path: "/conversas" },
      { title: "Voz", icon: Phone, path: "/voz" },
    ],
  },
  {
    category: "Marketing",
    items: [
      { title: "Origem e anúncios", icon: Megaphone, path: "/origem" },
      { title: "Disparos", icon: Send, path: "/disparos" },
    ],
  },
  { category: "Agente", items: [{ title: "Playbook e conexões", icon: Bot, path: "/agente" }, { title: "Integrações", icon: Plug, path: "/integracoes" }] },
];

const titles: Record<string, string> = {
  "/dashboard": "Visão geral",
  "/funil": "Funil",
  "/decisao": "Decisão do piloto",
  "/conversas": "Conversas",
  "/voz": "Voz",
  "/origem": "Origem e anúncios",
  "/disparos": "Disparos",
  "/agente": "Playbook e conexões",
  "/integracoes": "Integrações",
};

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("hz-theme", next); } catch { /* sem storage, segue */ }
    setTheme(next);
  };
  return { theme, toggle };
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const [open, setOpen] = useState<string[]>(["Dashboard"]);

  const active = "bg-white/12 text-white font-medium shadow-[0_0_20px_-6px_rgb(var(--sinal)/0.35)] ring-1 ring-white/10";
  const idle = "text-white/70 hover:bg-white/8 hover:text-white";
  const base = "group flex min-h-[44px] items-center rounded-lg text-sm transition-colors";

  return (
    <nav aria-label="Principal" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {nav.map((cat) => (
        <div key={cat.category}>
          {!collapsed && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{cat.category}</p>}
          <div className="space-y-1">
            {cat.items.map((item) => {
              const Icon = item.icon;
              if (item.modules) {
                const expanded = open.includes(item.title);
                const inside = item.modules.some((m) => m.path === path);
                return (
                  <div key={item.title}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={item.title}
                      title={collapsed ? item.title : undefined}
                      onClick={() => setOpen((o) => (o.includes(item.title) ? o.filter((t) => t !== item.title) : [...o, item.title]))}
                      className={`${base} w-full ${collapsed ? "justify-center" : "gap-3 px-3"} ${inside ? active : idle}`}
                    >
                      <Icon size={18} aria-hidden="true" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left">{item.title}</span>
                          <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </>
                      )}
                    </button>
                    {expanded && (
                      <div className={`mt-1 space-y-1 ${collapsed ? "" : "ml-4 border-l border-white/10 pl-2"}`}>
                        {item.modules.map((m) => {
                          const MIcon = m.icon;
                          return (
                            <Link
                              key={m.path}
                              href={m.path}
                              onClick={onNavigate}
                              aria-current={path === m.path ? "page" : undefined}
                              aria-label={m.title}
                              title={collapsed ? m.title : undefined}
                              className={`${base} ${collapsed ? "justify-center" : "gap-3 px-3"} ${path === m.path ? active : idle}`}
                            >
                              <MIcon size={17} aria-hidden="true" />
                              {!collapsed && m.title}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <Link
                  key={item.title}
                  href={item.path!}
                  onClick={onNavigate}
                  aria-current={path === item.path ? "page" : undefined}
                  aria-label={item.title}
                  title={collapsed ? item.title : undefined}
                  className={`${base} ${collapsed ? "justify-center" : "gap-3 px-3"} ${path === item.path ? active : idle}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  {!collapsed && item.title}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const router = useRouter();
  const me = useMe();
  const userName = me.data?.name ?? "";
  const initials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "··";

  const logout = async () => {
    if (!DEMO) {
      try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* sessão local é limpa no próximo acesso */ }
    }
    router.replace("/login");
    router.refresh();
  };

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("hz-sidebar") === "1"); } catch { /* ignora */ }
  }, []);
  useEffect(() => setDrawer(false), [path]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("hz-sidebar", c ? "0" : "1"); } catch { /* ignora */ }
      return !c;
    });
  };

  const iconBtn = "inline-flex h-11 w-11 items-center justify-center rounded-lg text-mute transition-colors hover:bg-ink/10 hover:text-ink";
  const chatUrl = process.env.NEXT_PUBLIC_CHAT_URL;

  return (
    <div className="flex h-screen flex-col">
      <a href="#conteudo" className="sr-only z-50 rounded-md bg-brand px-4 py-2 font-semibold text-on-brand focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Pular para o conteúdo</a>
      <TopProgress />
      {/* TopBar */}
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-line bg-card/85 px-3 backdrop-blur-md sm:px-4 lg:px-6">
        <div className="flex items-center">
          <button type="button" className={`${iconBtn} lg:hidden`} aria-label="Abrir menu" onClick={() => setDrawer(true)}>
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="mr-5 hidden w-52 items-center border-r border-line pr-5 lg:flex">
            <Wordmark compact />
          </div>
          <button type="button" className={`${iconBtn} mr-2 hidden lg:inline-flex`} aria-label={collapsed ? "Expandir menu" : "Recolher menu"} onClick={toggleCollapsed}>
            <PanelLeft size={20} aria-hidden="true" />
          </button>
          <p className="font-display text-xl leading-none">{titles[path] ?? brand.short}</p>
        </div>
        <Ecg className="mx-6 hidden h-6 min-w-0 flex-1 md:block" />
        <div className="flex items-center gap-1">
          <button type="button" className={iconBtn} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"} onClick={toggle}>
            {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
          </button>
          <div className="ml-2 flex items-center gap-2.5 border-l border-line pl-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-deep text-xs font-bold text-white" aria-hidden="true">{initials}</span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block max-w-[180px] truncate text-sm font-semibold">{userName || (me.isError ? "Sessão indisponível" : "Carregando…")}</span>
              <span className="block max-w-[180px] truncate text-xs text-mute">{me.data?.email ?? brand.short}</span>
            </span>
            <button type="button" className={iconBtn} aria-label="Sair" title="Sair" onClick={logout}>
              <LogOut size={19} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar desktop */}
        <aside className={`hidden shrink-0 flex-col bg-deep text-white transition-[width] duration-200 lg:flex ${collapsed ? "w-[72px]" : "w-64"}`}>
          <SidebarNav collapsed={collapsed} />
          {!collapsed && <p className="px-6 pb-5 text-xs text-white/40">{brand.footer}</p>}
        </aside>

        {/* Sidebar mobile */}
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" className="absolute inset-0 bg-black/50" aria-label="Fechar menu" onClick={() => setDrawer(false)} />
            <aside className="relative flex h-full w-72 flex-col bg-deep text-white">
              <div className="flex h-16 items-center justify-between px-4">
                <Wordmark light compact />
                <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-white/80 hover:bg-white/10" aria-label="Fechar menu" onClick={() => setDrawer(false)}>
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <SidebarNav collapsed={false} onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}

        <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto px-4 pb-24 pt-8 sm:px-8 lg:px-10">
          {children}
          <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-mute">
            <span>{brand.footer}</span>
            <Link href="/privacidade" className="inline-flex min-h-[44px] items-center underline underline-offset-2 hover:text-ink">Privacidade e dados pessoais (LGPD)</Link>
          </footer>
        </main>
      </div>

      {/* Dock flutuante, como no HDM: atalho para o chat (só aparece se houver URL configurada) */}
      {chatUrl ? (
        <a
          href={chatUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir conversas"
          className="fixed bottom-5 right-5 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-brand px-5 text-sm font-bold text-on-brand shadow-lg transition-transform hover:-translate-y-0.5"
        >
          <MessageSquare size={20} aria-hidden="true" />
          <span className="hidden sm:inline">Conversas</span>
        </a>
      ) : (
        // Sem chat externo configurado, o atalho leva à página de conversas do próprio painel.
        path !== "/conversas" && (
          <Link
            href="/conversas"
            aria-label="Abrir conversas"
            className="fixed bottom-5 right-5 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-brand px-5 text-sm font-bold text-on-brand shadow-lg transition-transform hover:-translate-y-0.5"
          >
            <MessageSquare size={20} aria-hidden="true" />
            <span className="hidden sm:inline">Conversas</span>
          </Link>
        )
      )}
    </div>
  );
}


