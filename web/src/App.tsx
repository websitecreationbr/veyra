import { useEffect } from "react";
import { AuthProvider, useAuth } from "./state/auth";
import { RouterProvider, useRouter } from "./state/router";
import { AppProvider } from "./state/app";
import { Nav } from "./components/Nav";
import { Toasts } from "./components/ui";
import { Logo } from "./components/Icon";
import { AuthScreen } from "./screens/Auth";
import { Home } from "./screens/Home";
import { Flow } from "./screens/Flow";
import { Finance } from "./screens/Finance";
import { Agenda } from "./screens/Agenda";
import { More } from "./screens/More";

function Screen() {
  const { path } = useRouter();
  useEffect(() => {
    document.title = { "/": "Veyra", "/flow": "Flow · Veyra", "/financas": "Finanças · Veyra", "/agenda": "Agenda · Veyra", "/mais": "Mais · Veyra" }[path];
  }, [path]);
  switch (path) {
    case "/flow": return <Flow />;
    case "/financas": return <Finance />;
    case "/agenda": return <Agenda />;
    case "/mais": return <More />;
    default: return <Home />;
  }
}

function Gate() {
  const { status } = useAuth();
  const { path } = useRouter();
  if (status === "loading") return <div className="splash"><Logo size={44} /></div>;
  if (status === "anon") return <AuthScreen />;
  return (
    <div className={`shell route-${path === "/" ? "home" : path.slice(1)}`}>
      <a className="skip" href="#main">Ir para o conteúdo</a>
      <Nav />
      <main id="main" className="main"><Screen /></main>
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <RouterProvider>
        <AppProvider>
          <Gate />
        </AppProvider>
      </RouterProvider>
    </AuthProvider>
  );
}
