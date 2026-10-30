import { useEffect, useState } from "react";
import "./App.css";
import Home from "./components/Home";
import Editor from "./components/Editor";
import { installCloseGuard } from "./lib/closeGuard";

interface Open {
  dir: string;
  /** Message à afficher à l'ouverture (ex : médias à ré-importer après un import legacy). */
  notice: string | null;
}

function App() {
  const [open, setOpen] = useState<Open | null>(null);
  /** Ouvre la fenêtre de création de projet dès l'arrivée sur l'accueil (menu Fichier > Nouveau). */
  const [startNewProject, setStartNewProject] = useState(false);

  // Fermer la fenêtre termine d'abord l'enregistrement des modifications en attente.
  useEffect(() => {
    const installed = installCloseGuard();
    return () => {
      void installed.then((remove) => remove());
    };
  }, []);

  if (open) {
    return (
      // `key` : ouvrir un autre projet remonte tout l'éditeur. Sans cela, l'historique
      // d'annulation du projet précédent survivrait, et Ctrl+Z restaurerait l'ancien projet dans
      // le dossier du nouveau (la sauvegarde automatique l'y écrirait).
      <Editor
        key={open.dir}
        projectDir={open.dir}
        initialNotice={open.notice}
        onBack={(intent) => {
          setStartNewProject(intent === "new");
          setOpen(null);
        }}
        onOpenProject={(dir, notice) => setOpen({ dir, notice: notice ?? null })}
      />
    );
  }

  return (
    <Home
      startNewProject={startNewProject}
      onOpenProject={(dir) => {
        setStartNewProject(false);
        setOpen({ dir, notice: null });
      }}
    />
  );
}

export default App;
