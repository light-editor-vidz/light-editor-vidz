import { editor, tools, type Editor, type Tool } from './content';

export type Lang = 'fr' | 'en';
export type Bi = { fr: string; en: string };
export type Block = { title: Bi; body?: Bi; code?: Bi };

const b = (fr: string, en: string): Bi => ({ fr, en });
const same = (s: string): Bi => ({ fr: s, en: s });

// Adresse publique du site : les scripts d'installation y sont servis (voir scripts/prepare.mjs).
export const SITE = 'https://light-editor-vidz.github.io/light-editor-vidz';

export interface App extends Omit<Editor, 'pkg' | 'h'> {
  h1: number;
  h2: number;
  install: Block[];
  uninstall: Block[];
  command: string;
  uninstallCommand: string;
}

function build(id: string, c: Editor) {
  const o = c.pkg;
  const command = `curl -fsSL ${SITE}/install.sh | bash`;
  const uninstallCommand = `curl -fsSL ${SITE}/uninstall.sh | bash`;
  const cask = `light-${id}/tap/light-${id}`;

  const install: Block[] = [
    {
      title: b('macOS', 'macOS'),
      body: b(
        "Le script installe l'application avec Homebrew (cask). Si vous préférez, vous pouvez le faire vous-même :",
        'The script installs the app with Homebrew (cask). If you prefer, you can do it yourself:',
      ),
      code: same(`brew install --cask ${cask}`),
    },
    {
      title: same('Linux, Debian / Ubuntu'),
      body: b(
        'Le script télécharge le paquet .deb de la dernière version, vérifie sa somme SHA-256 et l’installe avec apt.',
        'The script downloads the latest .deb, checks its SHA-256 sum and installs it with apt.',
      ),
    },
    ...(o.rpm
      ? [
          {
            title: same('Linux, Fedora / openSUSE'),
            body: b(
              'Le script installe le paquet .rpm avec dnf ou zypper.',
              'The script installs the .rpm package with dnf or zypper.',
            ),
          },
        ]
      : []),
    {
      title: b('Linux, autres distributions', 'Linux, other distributions'),
      body: b(
        "Le script place l'AppImage dans ~/.local/bin et l'ajoute au menu des applications (entrée .desktop et icône). Les AppImage demandent FUSE 2 (libfuse2), ou se lancent avec --appimage-extract-and-run.",
        'The script puts the AppImage in ~/.local/bin and registers it in the applications menu (.desktop entry and icon). AppImages need FUSE 2 (libfuse2), or run with --appimage-extract-and-run.',
      ),
    },
    {
      title: b('Mise à jour', 'Updating'),
      body: b(
        'Relancez la même commande pour passer à la dernière version. Sous macOS, `brew upgrade --cask` fonctionne aussi.',
        'Run the same command again to move to the latest version. On macOS, `brew upgrade --cask` works too.',
      ),
      code: same(`brew upgrade --cask ${cask}`),
    },
    {
      title: b('Vérification des téléchargements', 'Checking downloads'),
      body: b(
        "Chaque version publie un fichier SHA256SUMS ; le script compare la somme du paquet téléchargé et refuse de continuer si elle ne correspond pas.",
        'Each release publishes a SHA256SUMS file; the script compares the downloaded package’s sum and refuses to continue if it does not match.',
      ),
    },
  ];

  const uninstall: Block[] = [
    {
      title: b('Toutes plateformes, un script', 'All platforms, one script'),
      body: b(
        "Détecte comment l'application a été installée (Homebrew, apt, dnf/zypper, AppImage) et la retire, avec son entrée de menu et son icône. Retirer ce qui n'a jamais été installé n'est pas une erreur.",
        'Detects how the app was installed (Homebrew, apt, dnf/zypper, AppImage) and removes it, with its menu entry and icon. Removing something that was never installed is not an error.',
      ),
      code: o.purge
        ? b(
            `${uninstallCommand}\n# Ajoutez  -s -- --purge  après bash pour effacer aussi les réglages (langue enregistrée)`,
            `${uninstallCommand}\n# Add  -s -- --purge  after bash to also delete the settings (saved language)`,
          )
        : same(uninstallCommand),
    },
    {
      title: b('macOS (Homebrew)', 'macOS (Homebrew)'),
      code: b(
        `brew uninstall --cask light-${id}\nbrew untap light-${id}/tap\n\n# Supprimer aussi réglages et caches\nbrew uninstall --zap --cask light-${id}`,
        `brew uninstall --cask light-${id}\nbrew untap light-${id}/tap\n\n# Also remove settings and caches\nbrew uninstall --zap --cask light-${id}`,
      ),
    },
    { title: same('Linux, Debian / Ubuntu'), code: same(`sudo apt remove ${o.apt}`) },
    ...(o.rpm ? [{ title: same('Linux, Fedora / openSUSE'), code: same(`sudo dnf remove ${o.apt}`) }] : []),
    {
      title: same('Linux, AppImage'),
      code: same(
        `rm ~/.local/bin/${o.ai}.AppImage\nrm ~/.local/share/applications/${o.ai}.desktop\nrm ~/.local/share/icons/hicolor/${o.icon}x${o.icon}/apps/${o.ai}.png\nupdate-desktop-database ~/.local/share/applications`,
      ),
    },
  ];
  return { install, uninstall, command, uninstallCommand };
}

const { pkg, h, ...rest } = editor;
export const app: App = { ...rest, h1: h[0], h2: h[1], ...build(editor.id, editor) } as App;

export { tools };
export type { Tool };
export const toolById = (id: string) => tools.find((t) => t.id === id)!;
