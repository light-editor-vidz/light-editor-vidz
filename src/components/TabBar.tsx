import { useTranslation } from "react-i18next";
import { Clapperboard, Home as HomeIcon, Image as ImageIcon, Music, X } from "lucide-react";
import { baseName } from "../lib/audiotool/helpers";
import { HOME, type Tab } from "../lib/tabs";
import "./TabBar.css";

interface Props {
  tabs: Tab[];
  active: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

function titleOf(tab: Tab, emptyLabel: string): string {
  if (tab.kind === "project") return baseName(tab.dir).replace(/\.lvproj$/, "");
  return tab.path ? baseName(tab.path) : emptyLabel;
}

/** La barre d'onglets : l'accueil, puis un onglet par projet et par fichier audio ouverts. */
export default function TabBar({ tabs, active, onActivate, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div className="tabbar" role="tablist" aria-label={t("tabs.label")}>
      <button
        type="button"
        role="tab"
        aria-selected={active === HOME}
        className={`tab tab-home${active === HOME ? " active" : ""}`}
        onClick={() => onActivate(HOME)}
        title={t("tabs.home")}
      >
        <HomeIcon size={14} />
        <span>{t("tabs.home")}</span>
      </button>
      {tabs.map((tab) => {
        const title = titleOf(tab, t(tab.kind === "image" ? "tabs.image" : "tabs.audio"));
        const Icon = tab.kind === "audio" ? Music : tab.kind === "image" ? ImageIcon : Clapperboard;
        return (
          <div key={tab.id} className={`tab${active === tab.id ? " active" : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              className="tab-main"
              onClick={() => onActivate(tab.id)}
              title={tab.kind === "project" ? tab.dir : (tab.path ?? title)}
            >
              <Icon
                size={14}
                className={
                  tab.kind === "audio" ? "tab-icon-audio" : tab.kind === "image" ? "tab-icon-image" : "tab-icon-project"
                }
              />
              <span className="tab-title">{title}</span>
            </button>
            <button
              type="button"
              className="tab-close"
              onClick={() => onClose(tab.id)}
              title={t("tabs.close")}
              aria-label={t("tabs.closeNamed", { name: title })}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
