import type { Bi } from './apps';

const b = (fr: string, en: string): Bi => ({ fr, en });

export interface Step {
  shot?: string; // nom du fichier dans public/screenshots/{id}/{shot}-{lang}.webp
  title: Bi;
  body: Bi;
}
export interface Group {
  title: Bi;
  items: { title: Bi; body: Bi }[];
}
export interface Content {
  id: string;
  h: [number, number];
  name: string;
  kind: Bi;
  tagline: Bi;
  short: Bi;
  intro: Bi[];
  hero: string; // capture principale
  how: Step[];
  groups: Group[];
  formats: { label: Bi; value: Bi }[];
  shortcuts: { keys: string; label: Bi }[];
  notes: { title: Bi; body: Bi }[];
  examples: { title: Bi; steps: Bi[] }[];
  platform: Bi;
  reqs: Bi[];
  pkg: { pkg: string; apt: string; ai: string; icon: number; rpm?: boolean; purge?: boolean };
}

export const content: Content[] = [
  {
    id: 'editor-vidz',
    h: [355, 305],
    name: 'LightEditorVidz',
    kind: b('Création vidéo, audio et image', 'Video, audio and image creator'),
    tagline: b(
      'Composez des scènes avec texte, images, vidéo, audio et formes, retouchez un son, une image ou une vidéo, générez des sous-titres, et exportez, en local, sans filigrane.',
      'Compose scenes with text, images, video, audio and shapes, edit a sound, an image or a video, generate subtitles, and export, locally, no watermark.',
    ),
    short: b(
      'Scènes sur une timeline, vues Audio, Image et Vidéo, sous-titres automatiques et export mp4 natif.',
      'Scenes on a timeline, Audio, Image and Video views, automatic subtitles and native mp4 export.',
    ),
    intro: [
      b(
        "LightEditorVidz assemble une vidéo à partir de scènes disposées sur une timeline, avec une vraie horloge de lecture. Chaque scène contient des éléments (texte, image, vidéo, audio, formes) que vous placez, redimensionnez et faites pivoter directement sur le canevas. Un panneau de propriétés règle les détails et une liste de calques ordonne la superposition.",
        'LightEditorVidz builds a video from scenes laid out on a timeline, with a real playback clock. Each scene holds elements (text, image, video, audio, shapes) that you place, resize and rotate directly on the canvas. A properties panel sets the details and a layers list orders the stacking.',
      ),
      b(
        "Pour une retouche rapide, pas besoin de projet : l'écran d'accueil ouvre une vue Audio (coupes, fondus, filtres), une vue Image (recadrage, retouches, suppression d'objet) ou une vue Vidéo (découpe, recadrage, filtres, stabilisation). Fichier › Ouvrir un fichier choisit la bonne vue d'après le type du fichier. La génération de sous-titres est disponible partout où il y a un média.",
        'For a quick edit there is no need for a project: the home screen opens an Audio view (cuts, fades, filters), an Image view (crop, adjustments, object removal) or a Video view (trim, crop, filters, stabilisation). File › Open file picks the right view from the file type. Subtitle generation is available wherever there is a media.',
      ),
      b(
        "À l'export, les images sont rastérisées nativement, en parallèle, puis envoyées à ffmpeg, qui mixe l'audio dans la même passe : le fichier .mp4 correspond à ce que vous voyez. ffmpeg est inclus, rien d'autre à installer. Un projet est un dossier portable (.lvproj) avec un fichier project.json et vos médias : vous pouvez le copier, l'archiver ou le versionner. Les modifications sont enregistrées automatiquement.",
        'On export, frames are rasterized natively, in parallel, then piped to ffmpeg, which mixes the audio in the same pass: the .mp4 matches what you see. ffmpeg is included, nothing else to install. A project is a portable folder (.lvproj) with a project.json file and your media: you can copy, archive or version it. Changes are saved automatically.',
      ),
    ],
    hero: 'editor',
    how: [
      {
        shot: 'home',
        title: b("1. Choisissez par où commencer", '1. Pick where to start'),
        body: b(
          "L'accueil propose Nouveau projet, Ouvrir un projet, et les vues Audio, Image et Vidéo pour une retouche rapide sans projet. Fichier › Ouvrir un fichier (Ctrl+O) ouvre un son dans la vue Audio, une image dans la vue Image, une vidéo dans la vue Vidéo ; vous pouvez aussi déposer un fichier sur la fenêtre. Chaque fichier ou projet ouvert a son onglet.",
          'The home screen offers New project, Open project, and the Audio, Image and Video views for a quick edit without a project. File › Open file (Ctrl+O) opens a sound in the Audio view, an image in the Image view, a video in the Video view; you can also drop a file on the window. Each open file or project has its own tab.',
        ),
      },
      {
        shot: 'new',
        title: b('2. Créez un projet', '2. Create a project'),
        body: b(
          "« Nouveau projet » demande un nom, une résolution (16:9 en 1920×1080, 9:16 en 1080×1920, 1:1 en 1080×1080 ou UHD 3840×2160) et une cadence (24, 30 ou 60 images/s), puis le dossier où créer le projet. « Ouvrir un projet » reprend un dossier .lvproj existant, y compris l'ancien format JSON.",
          '“New project” asks for a name, a resolution (16:9 at 1920×1080, 9:16 at 1080×1920, 1:1 at 1080×1080 or UHD 3840×2160) and a frame rate (24, 30 or 60 fps), then the folder to create the project in. “Open project” reopens an existing .lvproj folder, including the legacy JSON format.',
        ),
      },
      {
        shot: 'editor',
        title: b('3. Ajoutez, animez et montez', '3. Add, animate and edit'),
        body: b(
          "La barre de gauche ouvre les bibliothèques : Texte (titre, sous-titre, styles animés), Vidéos, Images, Audio et Formes. Un clic ajoute l'élément à la scène ; vous le placez sur le canevas, et le panneau de droite règle contenu, police, couleur, bordure, ombre, mode de fusion. Ajoutez des animations d'entrée ou de sortie qui se cumulent, un mouvement Ken Burns sur les images, une transition entre deux scènes. La timeline permet de scinder, dupliquer, grouper (Ctrl+G) et réordonner.",
          'The left bar opens the libraries: Text (title, subtitle, animated styles), Videos, Images, Audio and Shapes. One click adds the element to the scene; you place it on the canvas, and the right panel sets content, font, colour, border, shadow, blend mode. Add entrance or exit animations that stack, a Ken Burns move on images, a transition between two scenes. The timeline lets you split, duplicate, group (Ctrl+G) and reorder.',
        ),
      },
      {
        title: b('4. Générez des sous-titres', '4. Generate subtitles'),
        body: b(
          "Depuis une vidéo ou un son (vues Vidéo et Audio), un élément vidéo ou une piste audio d'un projet, ou pour tout le projet : choisissez le moteur de transcription (local, ou Groq, OpenAI, Deepgram, AssemblyAI), la langue parlée et la piste audio. Corrigez le texte, traduisez-le après coup (l'original est gardé à côté de la traduction), puis ajoutez-le au projet, enregistrez-le en .srt, .vtt ou .ass, ou utilisez-le comme sous-titres incrustés dans la vue Vidéo.",
          'From a video or a sound (Video and Audio views), a video element or an audio track of a project, or for the whole project: pick the transcription engine (local, or Groq, OpenAI, Deepgram, AssemblyAI), the spoken language and the audio track. Correct the text, translate it afterwards (the original is kept next to the translation), then add it to the project, save it as .srt, .vtt or .ass, or use it as the burned-in subtitles of the Video view.',
        ),
      },
      {
        shot: 'export',
        title: b('5. Exportez où vous voulez', '5. Export wherever you want'),
        body: b(
          "Un projet s'exporte en .mp4 (résolution, cadence et qualité au choix) ou en audio seul. Les vues Audio, Image et Vidéo ont leurs propres formats. Dans chaque fenêtre d'export, choisissez « Sur mon ordinateur », « Ajouter à un projet », ou les deux : sans l'ordinateur, aucune fenêtre d'enregistrement ne s'ouvre et le fichier va directement dans la médiathèque des projets cochés. Quitter pendant un export demande confirmation.",
          'A project exports as .mp4 (resolution, frame rate and quality of your choice) or as audio only. The Audio, Image and Video views have their own formats. In every export window, choose “On my computer”, “Add to a project”, or both: without the computer, no save dialog opens and the file goes straight to the media library of the checked projects. Quitting during an export asks first.',
        ),
      },
    ],
    groups: [
      {
        title: b('Composition', 'Composition'),
        items: [
          { title: b('Timeline multi-scènes', 'Multi-scene timeline'), body: b("Une vraie horloge de lecture pilote l'aperçu, pas un minuteur à intervalle fixe.", 'A real playback clock drives the preview, not a fixed-interval timer.') },
          { title: b("Cinq types d'éléments", 'Five element types'), body: b('Texte, image, vidéo, audio et formes, tous déplacés, redimensionnés et pivotés par le même composant.', 'Text, image, video, audio and shapes, all moved, resized and rotated by the same component.') },
          { title: b('Calques et groupes', 'Layers and groups'), body: b('Liste de calques réordonnables, groupes (Ctrl+G / Ctrl+Maj+G), modes de fusion.', 'Reorderable layer list, groups (Ctrl+G / Ctrl+Shift+G), blend modes.') },
          { title: b('Animations et transitions', 'Animations and transitions'), body: b('Animations composables (fondu, glissement, zoom, rotation, flou, rebond, machine à écrire…), Ken Burns sur les images, transitions de scène avec chevauchement.', 'Composable animations (fade, slide, zoom, rotate, blur, bounce, typewriter…), Ken Burns on images, scene transitions with overlap.') },
          { title: b('Texte et formes', 'Text and shapes'), body: b("Texte riche et styles animés (Néon, Ombre, Boîte, Lueur, Contour, Impact…), formes avec remplissage uni ou dégradé, contour et rayon des angles.", 'Rich text and animated styles (Neon, Shadow, Box, Glow, Outline, Impact…), shapes with solid or gradient fill, stroke and corner radius.') },
          { title: b('Vidéo et son dans un projet', 'Video and sound in a project'), body: b('Filtre de couleur et recadrage sur un élément vidéo ; pistes audio avec volume, fondus (linéaire ou puissance égale), vitesse de 0,25× à 4×, filtres passe-bas, passe-haut et passe-bande, muet et solo.', 'Colour filter and crop on a video element; audio tracks with volume, fades (linear or equal power), speed from 0.25× to 4×, low-pass, high-pass and band-pass filters, mute and solo.') },
        ],
      },
      {
        title: b('Vue Audio', 'Audio view'),
        items: [
          { title: b("Coupes et fondus", 'Cuts and fades'), body: b("Marquez les passages à retirer sur la forme d'onde ; fondu d'entrée et de sortie, linéaire ou à puissance égale.", 'Mark the parts to remove on the waveform; fade in and out, linear or equal power.') },
          { title: b('Normalisation, vitesse, filtres', 'Normalisation, speed, filters'), body: b('Normalisation au pic (−1 dBFS), vitesse de 0,25× à 4×, filtres passe-bas et passe-haut de 12 à 48 dB/octave, passe-bande.', 'Peak normalisation (−1 dBFS), speed from 0.25× to 4×, low-pass and high-pass filters from 12 to 48 dB/octave, band-pass.') },
          { title: b('Aperçu en direct', 'Live preview'), body: b('Vous entendez les réglages pendant la lecture.', 'You hear the settings while it plays.') },
          { title: b('Export', 'Export'), body: b('WAV (16 bits, 24 bits ou 32 bits flottants), MP3, FLAC, OGG Vorbis, M4A, avec les tags et la pochette du fichier source.', 'WAV (16-bit, 24-bit or 32-bit float), MP3, FLAC, OGG Vorbis, M4A, with the tags and cover of the source file.') },
        ],
      },
      {
        title: b('Vue Image', 'Image view'),
        items: [
          { title: b('Recadrer, pivoter, redimensionner', 'Crop, rotate, resize'), body: b('Recadrage interactif avec rapports fixes, rotation libre, symétrie, redimensionnement et extension du canevas.', 'Interactive crop with fixed ratios, free rotation, flip, resize and canvas extension.') },
          { title: b('Retouches et filtres', 'Adjustments and filters'), body: b('Réglages et filtres prévisualisés en direct, pipette de couleur, copie dans le presse-papiers.', 'Adjustments and filters previewed live, colour picker, copy to clipboard.') },
          { title: b("Suppression d'objet", 'Object removal'), body: b("Effacez un élément de l'image par retouche (inpainting).", 'Erase an element from the image by inpainting.') },
          { title: b('Historique et EXIF', 'History and EXIF'), body: b('Historique des étapes avec retour direct à l\'une d\'elles, lecture et suppression des métadonnées EXIF, profil ICC conservé.', 'Step history with a direct jump back to any step, EXIF metadata reading and removal, ICC profile kept.') },
          { title: b('Export', 'Export'), body: b('PNG, JPEG (qualité réglable), WebP, BMP, TIFF ; format et qualité par défaut dans Fichier › Réglages.', 'PNG, JPEG (adjustable quality), WebP, BMP, TIFF; default format and quality in File › Settings.') },
        ],
      },
      {
        title: b('Vue Vidéo', 'Video view'),
        items: [
          { title: b('Découpe multi-segments', 'Multi-segment trim'), body: b('Marquez ce qu\'il faut retirer sur une timeline à vignettes ; vitesse de 0,25× à 4×, son coupé en un clic.', 'Mark what to remove on a filmstrip timeline; speed from 0.25× to 4×, mute in one click.') },
          { title: b('Cadrage et formats réseaux', 'Framing and social formats'), body: b('Recadrage libre, formats 9:16, 4:5, 1:1 et 16:9 avec fond flouté ou recadrage, rotation, redressement, perspective.', 'Free crop, 9:16, 4:5, 1:1 and 16:9 formats with a blurred background or a crop, rotation, straightening, perspective.') },
          { title: b('Filtres, stabilisation, sous-titres', 'Filters, stabilisation, subtitles'), body: b('Vingt filtres de couleur, stabilisation, sous-titres incrustés depuis un .srt avec sept animations.', 'Twenty colour filters, stabilisation, burned-in subtitles from an .srt with seven animations.') },
          { title: b("Export et file d'attente", 'Export and queue'), body: b("MP4, MOV, WebM, AVI ou GIF, qualité et résolution au choix, encodeurs matériels quand ils existent, file d'exports qui continue en arrière-plan.", 'MP4, MOV, WebM, AVI or GIF, quality and resolution of your choice, hardware encoders when available, an export queue that keeps going in the background.') },
        ],
      },
      {
        title: b('Sous-titres', 'Subtitles'),
        items: [
          { title: b('Transcription', 'Transcription'), body: b("En local avec whisper.cpp (modèles base, small, medium, téléchargés au premier usage et vérifiés), ou via Groq, OpenAI, Deepgram ou AssemblyAI. Langue détectée ou forcée, choix de la piste audio d'un film.", 'Locally with whisper.cpp (base, small, medium models, downloaded on first use and checked), or through Groq, OpenAI, Deepgram or AssemblyAI. Detected or forced language, choice of the audio track of a film.') },
          { title: b('Traduction', 'Translation'), body: b("En local avec NLLB-200, ou via DeepL, OpenAI, Google Translate ou Azure Translator. L'original est gardé à côté de la traduction ; chaque version se corrige et s'enregistre séparément.", 'Locally with NLLB-200, or through DeepL, OpenAI, Google Translate or Azure Translator. The original is kept next to the translation; each version is corrected and saved separately.') },
          { title: b('Sous-titres liés au média', 'Subtitles linked to the media'), body: b("Les sous-titres générés restent liés à leur vidéo ou son. Dans un projet, ils s'activent par média et suivent le média quand on le déplace, le coupe ou l'accélère.", 'Generated subtitles stay linked to their video or sound. In a project they switch on per media and follow it when it is moved, trimmed or sped up.') },
          { title: b('Confidentialité', 'Privacy'), body: b("Un moteur cloud n'est utilisé que si vous le choisissez, et la fenêtre dit alors ce qu'il reçoit (l'audio ou le texte). Les clés d'API sont gardées dans le trousseau du système.", 'A cloud engine is used only if you pick it, and the window then says what it receives (the audio or the text). API keys are kept in the system keyring.') },
        ],
      },
      {
        title: b('Édition et export', 'Editing and export'),
        items: [
          { title: b('Historique partout', 'History everywhere'), body: b("Annuler et rétablir dans toutes les vues, et un panneau Historique (Édition › Historique, Ctrl+Maj+H) qui nomme chaque étape et y ramène d'un clic.", 'Undo and redo in every view, and a History panel (Edit › History, Ctrl+Shift+H) that names each step and jumps back to it with one click.') },
          { title: b('Exporter vers un projet', 'Export into a project'), body: b("Toute exportation peut aller sur l'ordinateur, dans la médiathèque d'un ou plusieurs projets, ou les deux.", 'Any export can go to the computer, into the media library of one or several projects, or both.') },
          { title: b('Export mp4 réel', 'Real mp4 export'), body: b("Rastérisation native en parallèle, ffmpeg en sortie, annulable, avec un rapport des médias illisibles. Export audio seul du mixage d'un projet.", 'Native parallel rasterization, ffmpeg output, cancellable, with a report of unreadable media. Audio-only export of a project mix.') },
          { title: b('Enregistrement automatique', 'Autosave'), body: b("Les modifications d'un projet sont enregistrées d'elles-mêmes ; quitter pendant un travail en cours demande confirmation.", "A project's changes save themselves; quitting while work is running asks first.") },
          { title: b('Mises à jour signées, bilingue', 'Signed updates, bilingual'), body: b('Aide › Rechercher les mises à jour télécharge, installe et relance. Interface en français et en anglais, thème clair ou sombre.', 'Help › Check for updates downloads, installs and relaunches. English and French interface, light or dark theme.') },
        ],
      },
    ],
    formats: [
      { label: b('Projet', 'Project'), value: b('Dossier .lvproj (project.json + médias), import de l’ancien format JSON', '.lvproj folder (project.json + media), legacy JSON import') },
      { label: b('Export vidéo', 'Video export'), value: b('.mp4 (projets) ; MP4, MOV, WebM, AVI, GIF (vue Vidéo)', '.mp4 (projects); MP4, MOV, WebM, AVI, GIF (Video view)') },
      { label: b('Export audio', 'Audio export'), value: b('WAV, MP3, FLAC, OGG Vorbis, M4A', 'WAV, MP3, FLAC, OGG Vorbis, M4A') },
      { label: b('Export image', 'Image export'), value: b('PNG, JPEG, WebP, BMP, TIFF', 'PNG, JPEG, WebP, BMP, TIFF') },
      { label: b('Sous-titres', 'Subtitles'), value: b('.srt, .vtt, .ass', '.srt, .vtt, .ass') },
    ],
    shortcuts: [
      { keys: 'Ctrl+O', label: b('Ouvrir un fichier', 'Open a file') },
      { keys: 'Ctrl+S', label: b('Enregistrer (projet)', 'Save (project)') },
      { keys: 'Ctrl+E', label: b('Exporter', 'Export') },
      { keys: 'Ctrl+Z / Ctrl+Shift+Z', label: b('Annuler / rétablir', 'Undo / redo') },
      { keys: 'Ctrl+Shift+H', label: b("Afficher l'historique", 'Show the history') },
      { keys: 'Ctrl+C / Ctrl+V', label: b('Copier / coller', 'Copy / paste') },
      { keys: 'Ctrl+D', label: b('Dupliquer', 'Duplicate') },
      { keys: 'Ctrl+G / Ctrl+Shift+G', label: b('Grouper / dégrouper', 'Group / ungroup') },
      { keys: 'Ctrl+W', label: b("Fermer l'onglet", 'Close the tab') },
    ],
    notes: [
      { title: b('Un projet portable', 'A portable project'), body: b("Le dossier .lvproj contient project.json et un sous-dossier assets/ (images, audio, vidéos copiés à l'import). Déplacez ou archivez le dossier entier pour déplacer le projet.", 'The .lvproj folder holds project.json and an assets/ subfolder (images, audio, videos copied on import). Move or archive the whole folder to move the project.') },
      { title: b('Local par défaut', 'Local by default'), body: b("Vos fichiers restent sur votre machine. Seuls les moteurs cloud de sous-titres que vous choisissez envoient de l'audio ou du texte à leur fournisseur ; la fenêtre le signale.", 'Your files stay on your machine. Only the cloud subtitle engines you pick send audio or text to their provider; the window says so.') },
      { title: b('Polices', 'Fonts'), body: b("Le texte utilise Manrope et JetBrains Mono, fournies. Toute autre police doit être installée sur le système pour être utilisée à l'export.", 'Text uses the bundled Manrope and JetBrains Mono. Any other font name must be installed on the system for the export to use it.') },
      { title: b('Aperçu des vidéos sous Linux', 'Video preview on Linux'), body: b("Une vidéo que le système ne sait pas décoder est convertie en un aperçu temporaire ; l'export repart toujours du fichier d'origine. Le paquet .deb installe gstreamer1.0-libav pour lire le H.264 et l'AAC.", 'A video the system cannot decode is converted to a temporary preview; the export always starts again from the original file. The .deb package installs gstreamer1.0-libav to play H.264 and AAC.') },
    ],
    examples: [
      { title: b('Un titre animé', 'An animated title'), steps: [b('Dans Texte, cliquez sur « Ajouter un titre ».', 'In Text, click “Add a title”.'), b('Appliquez un fondu puis un glissement : ils se cumulent.', 'Apply a fade then a slide: they stack.'), b('Exportez en mp4.', 'Export as mp4.')] },
      { title: b('Une vidéo verticale pour les réseaux', 'A vertical video for social media'), steps: [b('Ouvrez la vue Vidéo et choisissez le format 9:16 avec fond flouté.', 'Open the Video view and pick the 9:16 format with a blurred background.'), b('Générez les sous-titres et incrustez-les.', 'Generate the subtitles and burn them in.'), b('Exportez en MP4 : le fichier peut aller sur votre ordinateur et dans un projet en même temps.', 'Export as MP4: the file can go to your computer and into a project at the same time.')] },
      { title: b('Un diaporama avec musique', 'A slideshow with music'), steps: [b('Ajoutez une image par scène avec un Ken Burns et une transition entre scènes.', 'Add one image per scene with a Ken Burns move and a transition between scenes.'), b("Nettoyez la musique dans la vue Audio (coupes, fondus), puis ajoutez-la à un projet à l'export.", 'Clean up the music in the Audio view (cuts, fades), then add it to a project on export.'), b('Placez-la en piste audio et exportez.', 'Place it as an audio track and export.')] },
      { title: b('Sous-titrer et traduire une interview', 'Subtitle and translate an interview'), steps: [b('Ouvrez le fichier, générez les sous-titres, corrigez-les.', 'Open the file, generate the subtitles, correct them.'), b("Traduisez-les : l'original reste dans le premier onglet.", 'Translate them: the original stays in the first tab.'), b('Enregistrez chaque version en .srt ou .vtt.', 'Save each version as .srt or .vtt.')] },
      { title: b('Préparer une image pour un projet', 'Prepare an image for a project'), steps: [b('Ouvrez la vue Image, recadrez et retouchez.', 'Open the Image view, crop and adjust.'), b("Exportez en cochant « Ajouter à un projet » sans « Sur mon ordinateur ».", 'Export with “Add to a project” checked and “On my computer” unchecked.'), b("L'image est dans la médiathèque du projet, prête à poser sur une scène.", 'The image is in the project media library, ready to place on a scene.')] },
    ],
    platform: b('macOS sur Apple Silicon, Linux x86_64 et ARM64 (.deb, AppImage).', 'macOS on Apple Silicon, Linux x86_64 and ARM64 (.deb, AppImage).'),
    reqs: [
      b('macOS : Apple Silicon (M1 et suivants) uniquement.', 'macOS: Apple Silicon (M1 and later) only.'),
      b('Linux : glibc 2.39 ou plus (Ubuntu 24.04 ou équivalent).', 'Linux: glibc 2.39 or later (Ubuntu 24.04 or equivalent).'),
      b('ffmpeg est inclus : rien à installer.', 'ffmpeg is included: nothing to install.'),
      b("Les polices hors Manrope et JetBrains Mono doivent être installées sur le système pour l'export.", 'Fonts other than Manrope and JetBrains Mono must be installed on the system for the export.'),
    ],
    pkg: { pkg: 'LightEditorVidz', apt: 'light-editor-vidz', ai: 'light-editor-vidz', icon: 512 },
  },
];
