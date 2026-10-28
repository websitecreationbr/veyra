import { Icon, Logo, type IconName } from "./Icon";
import { Link, useRouter, type RoutePath } from "../state/router";

const ITEMS: { to: RoutePath; label: string; icon: IconName }[] = [
  { to: "/", label: "Início", icon: "home" },
  { to: "/flow", label: "Flow", icon: "flow" },
  { to: "/financas", label: "Finanças", icon: "wallet" },
  { to: "/agenda", label: "Agenda", icon: "calendar" },
  { to: "/mais", label: "Mais", icon: "more" },
];

export function Nav() {
  const { path } = useRouter();
  return (
    <nav className="nav" aria-label="Principal">
      <div className="nav-brand"><Logo size={30} /><span>Veyra</span></div>
      <ul>
        {ITEMS.map((i) => (
          <li key={i.to}>
            <Link to={i.to} className={`nav-item ${path === i.to ? "is-active" : ""} ${i.to === "/flow" ? "is-flow" : ""}`} aria-current={path === i.to ? "page" : undefined}>
              <span className="nav-icon"><Icon name={i.icon} size={i.to === "/flow" ? 22 : 22} /></span>
              <span className="nav-label">{i.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
