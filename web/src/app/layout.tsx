import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { brand } from "@/lib/brand";
import "./globals.css";

// Uma família só (IBM Plex Sans): feita para interfaces corporativas, com números tabulares e acentuação completa.
// Títulos, texto e números usam a mesma fonte; o que muda é o peso. Trocar de fonte = trocar esta linha.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: brand.name,
  description: brand.description,
  robots: { index: false, follow: false },
};

// Aplica o tema antes da hidratação para não piscar.
const themeScript = `try{var t=localStorage.getItem('hz-theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
