# Journal des modifications

Les changements notables de LightEditorVidz sont listés ici, du plus récent au plus ancien.
La version anglaise est dans [CHANGELOG.md](CHANGELOG.md) — gardez les deux synchronisées.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet utilise le [versionnage sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

- Un bouton Image sur l'accueil ouvre la vue image de LightCutImgz — recadrage, rotation, symétrie, redimensionnement, taille du canvas, ajustements, filtres, retouche d'objet, pipette, EXIF, historique et export — aux couleurs de l'éditeur. Fichier > Ouvrir un fichier… y ouvre une image au lieu de créer un projet.
- Onglets : l'accueil, chaque projet ouvert et chaque fichier audio ouvert ont leur propre onglet.
- Un bouton Audio sur l'accueil ouvre la vue audio de LightCutSoundz — forme d'onde avec coupes, fondus, normalisation, vitesse, filtres, aperçu en direct, annuler / rétablir et export en WAV, MP3, FLAC, OGG ou M4A — aux couleurs de l'éditeur.
- Fichier > Ouvrir un fichier… (Ctrl+O) ouvre un fichier audio dans un onglet Audio ; une vidéo ou une image crée un nouveau projet qui la contient. On peut aussi déposer des fichiers sur la fenêtre. L'ancien « Ouvrir un projet » devient Fichier > Ouvrir un dossier de projet… (Ctrl+Maj+O).
- Pistes audio : les fondus suivent une courbe linéaire ou à puissance constante, la vitesse va de 0,25× à 4× (la hauteur du son est conservée), et on peut appliquer un filtre passe-bas, passe-haut (12 à 48 dB/octave) ou passe-bande.
- Export audio seul : le mix de toutes les pistes et du son de vos vidéos, en WAV (16 bits, 24 bits ou 32 bits flottants), MP3, FLAC, OGG Vorbis ou M4A.

### Modifié

- ffmpeg et ffprobe sont désormais livrés avec l'application : rien à installer, sur toutes les plateformes.
- Les versions sont compilées pour Linux x86_64, Linux arm64 et macOS Apple Silicon (les Mac Intel ne sont plus pris en charge).

## [1.0.2] - 2026-11-02

### Modifié

- La barre de mise à jour est identique dans toutes les applications : même hauteur, mêmes libellés, mêmes boutons dans le même ordre.

## [1.0.1] - 2026-11-02

### Modifié

- Dépendances mises à jour vers leurs dernières versions compatibles.
- L'anneau de focus clavier est supprimé partout (boutons, champs, menus, curseurs, cases à cocher).

## [1.0.0] - 2026-10-30

### Ajouté

- Première version stable. Le README liste tout ce que fait LightEditorVidz.
