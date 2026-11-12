# Journal des modifications

Les changements notables de LightEditorVidz sont listés ici, du plus récent au plus ancien.
La version anglaise est dans [CHANGELOG.md](CHANGELOG.md) — gardez les deux synchronisées.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet utilise le [versionnage sémantique](https://semver.org/lang/fr/).

## [Unreleased]

## [1.1.1] - 2026-11-12

### Corrigé

- La version macOS : whisper.cpp est maintenant compilé pour macOS 11 ou plus récent, ce que la 1.1.0 ne faisait pas ; elle n'a donc été publiée que pour Linux.

## [1.1.0] - 2026-11-12

### Ajouté

- Génération de sous-titres (issue de LightGenSubz), là où se trouve le média : dans la vue Vidéo (panneau Sous-titres, « Générer à partir de l'audio… »), dans la vue Audio (bouton de l'en-tête), sur un élément vidéo ou une piste audio d'un projet (panneau des propriétés) et pour le projet entier (barre du haut ou menu Fichier) — le mixage de toutes les scènes et sons est transcrit en un seul jeu. La transcription se fait en local (whisper.cpp, modèles base / small / medium) ou via Groq, OpenAI, Deepgram ou AssemblyAI ; la traduction en local (NLLB-200) ou via DeepL, OpenAI, Google Translate ou Azure Translator. Dans un projet, le résultat peut être ajouté en éléments texte, enregistré en `.srt` / `.vtt` / `.ass`, ou les deux ; dans la vue Vidéo, il peut servir directement de sous-titres incrustés.
- Un bouton Vidéo sur l'accueil ouvre la vue vidéo de LightCutVidz — coupe, vitesse, recadrage, formats réseaux sociaux, rotation, 20 filtres de couleur, sous-titres gravés, stabilisation et export en MP4, MOV, WebM, AVI ou GIF avec file d'exports — aux couleurs de l'éditeur. Fichier > Ouvrir un fichier… y ouvre une vidéo.
- Un élément vidéo d'un projet peut avoir un filtre de couleur et un recadrage, visibles en direct et appliqués à l'export.
- Un bouton Image sur l'accueil ouvre la vue image de LightCutImgz — recadrage, rotation, symétrie, redimensionnement, taille du canvas, ajustements, filtres, retouche d'objet, pipette, EXIF, historique et export — aux couleurs de l'éditeur. Fichier > Ouvrir un fichier… y ouvre une image au lieu de créer un projet.
- Onglets : l'accueil, chaque projet ouvert et chaque fichier audio ouvert ont leur propre onglet.
- Un bouton Audio sur l'accueil ouvre la vue audio de LightCutSoundz — forme d'onde avec coupes, fondus, normalisation, vitesse, filtres, aperçu en direct, annuler / rétablir et export en WAV, MP3, FLAC, OGG ou M4A — aux couleurs de l'éditeur.
- Fichier > Ouvrir un fichier… (Ctrl+O) ouvre un fichier audio dans un onglet Audio ; une vidéo ou une image crée un nouveau projet qui la contient. On peut aussi déposer des fichiers sur la fenêtre. L'ancien « Ouvrir un projet » devient Fichier > Ouvrir un dossier de projet… (Ctrl+Maj+O).
- Pistes audio : les fondus suivent une courbe linéaire ou à puissance constante, la vitesse va de 0,25× à 4× (la hauteur du son est conservée), et on peut appliquer un filtre passe-bas, passe-haut (12 à 48 dB/octave) ou passe-bande.
- Export audio seul : le mix de toutes les pistes et du son de vos vidéos, en WAV (16 bits, 24 bits ou 32 bits flottants), MP3, FLAC, OGG Vorbis ou M4A.
- Panneau Historique dans les vues Audio, Vidéo et Image et dans les projets : chaque étape est listée avec un nom lisible (« Coupe ajoutée », « Recadrage », « Déplacement : Titre »…), et un clic revient — ou avance — à n'importe quelle étape. Édition > Historique (Ctrl+Maj+H) ou bouton Historique à côté d'Annuler / Rétablir.
- Vue Image : Fichier > Réglages… (Ctrl+Virgule) règle le format d'export et la qualité JPEG par défaut, et efface les images récentes.
- Les sous-titres peuvent être traduits après leur génération, depuis la langue détectée ou une langue choisie. L'original est gardé à côté de la traduction, dans deux onglets ; chacun se corrige et s'enregistre séparément, et « Version utilisée » décide laquelle est liée au média ou ajoutée au projet. Une traduction demandée avant la génération ne remplace plus l'original.
- La fenêtre des sous-titres indique quand un moteur cloud reçoit l'audio ou le texte, et affiche le temps écoulé et une estimation du temps restant pendant le travail.

### Corrigé

- Vue Vidéo : les vidéos se lisent sur Linux, où le WebView refuse les protocoles internes dans `<video>`, grâce à un flux strictement local ; une vidéo qu'il ne sait pas décoder est transcodée pour l'aperçu.
- Vue Vidéo : le bouton Générer des sous-titres ouvre sa fenêtre, Ctrl+Z / Ctrl+Y fonctionnent de nouveau et les vidéos ouvertes apparaissent dans les fichiers récents.
- La génération de sous-titres utilise le ffmpeg embarqué au lieu d'en exiger un sur le système ; elle s'annule pendant le mixage d'un projet, et quitter pendant un traitement nettoie ce qu'il a créé.
- Fenêtre de sous-titres : fermer la boîte d'enregistrement n'ajoute plus les sous-titres deux fois, la vue Audio peut enregistrer son résultat, la région Azure peut être saisie, une clé d'API enregistrée peut être oubliée, et les erreurs sans code sont lisibles.
- Vue Image : la copie dans le presse-papiers fonctionne de nouveau et la taille de la grille est de retour (menu Édition).
- La fenêtre d'export vidéo n'attend plus indéfiniment un travail qui se termine aussitôt.
- Vue Image : les fenêtres, cartes, bordures et textes gris étaient transparents ; ils retrouvent leurs couleurs.
- Les erreurs cloud des sous-titres (clé API refusée, quota atteint, service indisponible) sont traduites au lieu de s'afficher en anglais.

### Modifié

- Le `.deb` Linux installe `gstreamer1.0-libav` : le H.264 et l'AAC se prévisualisent sans rien installer d'autre.
- Les exports des vues Vidéo, Audio et Image peuvent être ajoutés à un ou plusieurs projets et apparaissent dans leur médiathèque.
- Les sous-titres générés sont associés automatiquement à leur vidéo ou à leur son. Dans un projet, ils s'activent à l'ajout du média ou depuis ses propriétés, suivent le média quand il est déplacé, coupé ou accéléré, et ont leur propre taille et position.
- Le texte des sous-titres générés se corrige juste après la génération et, dans la vue Vidéo, pendant leur utilisation.
- Un média passé en ligne de commande s'ouvre dans son onglet ; un second lancement le confie à la fenêtre ouverte.
- Le filtre de couleur « vignette » d'un élément vidéo est maintenant visible dans l'aperçu de l'éditeur.
- Les erreurs du moteur de sous-titres (pas d'audio, clé d'API absente, réseau, …) sont traduites.
- La vue Vidéo réessaie avec un aperçu transcodé quand le système ne sait pas décoder une vidéo d'abord jugée lisible.
- ffmpeg et ffprobe sont désormais livrés avec l'application : rien à installer, sur toutes les plateformes.
- Les versions sont compilées pour Linux x86_64, Linux arm64 et macOS Apple Silicon (les Mac Intel ne sont plus pris en charge).
- Exporter depuis les vues Vidéo, Audio et Image : choisissez « Sur mon ordinateur », « Ajouter à un projet », ou les deux. Sans l'ordinateur, aucune fenêtre d'enregistrement ne s'ouvre : le fichier va directement dans la médiathèque de chaque projet coché.
- Quitter ou redémarrer pour une mise à jour pendant un travail en cours (file d'exports vidéo, export audio, image ou projet, génération de sous-titres) demande d'abord confirmation et liste ce qui s'arrêterait.
- Les paquets Linux sont construits sur Ubuntu 24.04 et demandent glibc 2.39 ou plus (le moteur de traduction local l'exige).

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
