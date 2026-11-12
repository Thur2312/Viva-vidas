import { NextResponse, type NextRequest } from "next/server";

// Protege todas as rotas do app. Só confere a PRESENÇA do cookie de sessão;
// a validade é verificada (e renovada) pelo BFF a cada chamada de dados.
const PUBLIC = ["/login", "/privacidade", "/api/auth/login", "/api/auth/logout"];

export function middleware(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEMO === "true") return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.includes(pathname)) return NextResponse.next();
  if (req.cookies.get("hz_rt")?.value || req.cookies.get("hz_at")?.value) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
