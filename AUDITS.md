# Audit complet — LightEditorVidz v1.2.0

> Date : 2026-11-17 · Périmètre : tout le dépôt `light-editor-vidz/` (+ `homebrew-tap/`) · ~70 000 lignes de code source (hors tests), ~36 000 lignes de tests.

## Sommaire

1. [Méthode](#1-méthode)
2. [Synthèse](#2-synthèse)
3. [Outils automatiques et couverture de tests](#3-outils-automatiques-et-couverture-de-tests)
4. [Problèmes transverses](#4-problèmes-transverses)
5. [Constats détaillés par module](#5-constats-détaillés-par-module)
   - 5.1 [Backend Tauri : commandes, export, configuration](#51-backend-tauri--commandes-export-configuration-src-taurisrc)
   - 5.2 [`crates/scene-core` (rendu des frames)](#52-cratesscene-core--rendu-des-frames)
   - 5.3 [`crates/audio-dsp` et `crates/video-export`](#53-cratesaudio-dsp-et-cratesvideo-export)
   - 5.4 [Backend vue Image (`src-tauri/src/imgz`)](#54-backend-vue-image-src-taurisrcimgz)
   - 5.5 [Génération de sous-titres (`src-tauri/src/subz`)](#55-génération-de-sous-titres-src-taurisrcsubz)
   - 5.6 [Frontend éditeur de projet (`src/components/editor`, `src/lib`, `App`)](#56-frontend-éditeur-de-projet)
   - 5.7 [Frontend vues Vidéo, Audio, sous-titres](#57-frontend-vues-vidéo-audio-et-sous-titres)
   - 5.8 [Frontend vue Image et `src/suite`](#58-frontend-vue-image-et-srcsuite)
   - 5.9 [Build, CI, distribution](#59-build-ci-distribution)
6. [Plan d'action recommandé](#6-plan-daction-recommandé)
7. [Points forts du code](#7-points-forts-du-code)

---

## 1. Méthode

- **Lecture du code**, découpée en 9 périmètres analysés en parallèle. Les fichiers non-test ont été lus en entier, les tests survolés pour la couverture. Chaque constat cite `fichier:ligne`, décrit un scénario concret et a été vérifié dans le code, y compris dans le code des dépendances quand c'était nécessaire (`image` 0.25.10, `cosmic-text` 0.19, `tauri-plugin-store` 2.5.1, `img-parts` 0.4.2, whisper.cpp). Les doublons trouvés par plusieurs périmètres ont été fusionnés.
- **Revérification manuelle** des 3 constats critiques et de plusieurs constats de sévérité haute (voir 2.2).
- **Outils lancés** : `tsc --noEmit`, `eslint`, `vitest run`, `cargo clippy --workspace --all-targets`, `cargo test --workspace`, `npm audit`, `cargo audit`, couverture `vitest --coverage` (v8) et `cargo llvm-cov`.
- **Pas d'exécution de l'application.** Les constats sont issus de la lecture du code, aucun n'a été reproduit en exécutant l'application. Un seul est explicitement marqué « à confirmer » (§5.5, ponctuation OpenAI/Groq).

**Sévérités**
| Niveau | Définition |
|---|---|
| **Critique** | Perte de données utilisateur ou plantage dans un usage normal, sans contournement raisonnable |
| **Haute** | Bug visible dans un usage courant, faille exploitable sous conditions, ou perte de performance d'un ordre de grandeur |
| **Moyenne** | Bug sur un cas moins fréquent, incohérence fonctionnelle, gain de performance notable |
| **Basse** | Cas limite, robustesse, dette technique, petit gain |

---

## 2. Synthèse

### 2.1 Décompte (après dédoublonnage)

| Périmètre | Critique | Haute | Moyenne | Basse | Total |
|---|:-:|:-:|:-:|:-:|:-:|
| 5.1 Backend Tauri (commandes, export, config) | 0 | 1 | 5 | 14 | 20 |
| 5.2 `scene-core` (rendu) | 0 | 7 | 7 | 11 | 25 |
| 5.3 `audio-dsp` / `video-export` | 1 | 3 | 8 | 9 | 21 |
| 5.4 Backend Image (`imgz`) | 0 | 3 | 12 | 8 | 23 |
| 5.5 Sous-titres (`subz`) | 0 | 0 | 6 | 10 | 16 |
| 5.6 Frontend éditeur | 1 | 3 | 13 | 11 | 28 |
| 5.7 Frontend Vidéo / Audio / sous-titres | 1 | 6 | 10 | 10 | 27 |
| 5.8 + 5.9 Frontend Image, suite, build / CI / distribution | 0 | 3 | 9 | 23 | 35 |
| **Total** | **3** | **26** | **70** | **96** | **195** |

### 2.2 Les 3 constats critiques (tous revérifiés à la main)

| # | Constat | Emplacement |
|---|---|---|
| C1 | **Exporter une vidéo par-dessus sa source efface la source.** Aucune comparaison entrée/sortie. ffmpeg refuse de démarrer (« same as Input »), puis `run_job` supprime `output_path` sur toute erreur, c'est-à-dire la vidéo d'origine. | `src-tauri/src/commands/video_tool.rs:283`, `:669-676`, `:126-137` |
| C2 | **Une erreur de lecture dans la vue Vidéo efface tout le montage.** `onVideoError` appelle `loadVideo(videoPath, true)`, où `true` est `force` et non `keep`, donc `reset(undefined)` remet l'état par défaut : coupes, recadrage, filtres, sous-titres et historique. La confirmation de fermeture disparaît aussi. | `src/components/videotool/VideoTool.tsx:609`, `:224`, `:257` |
| C3 | **`preloadMedia` relit les vidéos entières en mémoire à chaque modification du projet.** L'effet dépend de `project`, donc il tourne à chaque `pointermove` d'un drag. Un fichier de plus de 384 Mo est jeté du cache aussitôt chargé, puis relu par IPC à la mutation suivante. Ce blob ne sert pourtant qu'en repli, puisque la lecture passe par `lvmedia://`. | `src/components/Editor.tsx:330-338`, `src/lib/mediaCache.ts:24,37-57,111-114` |

### 2.3 Les constats de sévérité haute, en bref

**Perte de données ou de travail**
- Export vidéo écrit directement dans la destination (pas de `.part`) : un échec ou une annulation détruit le fichier remplacé (§5.3).
- Quitter (Ctrl+Q) appelle `exit(0)`, sans garde, sans autosave et sans attendre les exports (§5.8).
- Fermer un onglet projet par la croix contourne `flush` et la gestion d'erreur d'écriture (§5.6).
- Vue Image : l'état « modifié » compare des positions d'historique, il est donc faux après un remplacement d'étape ou quand le budget est atteint. L'onglet se ferme alors sans confirmation (§5.8).
- Vue Image : `reset_tool` rejoue des coordonnées absolues dans un repère qui n'est plus le bon (§5.4).
- Éditeur de sous-titres liés : les textes de la vidéo A sont écrits sur la vidéo B, avec une `TypeError` possible (§5.6).
- Sous-titre généré jamais associé si la traduction enchaînée échoue (§5.7).
- Fenêtre d'export Vidéo bloquée à 100 % après « Exporter à nouveau » puis annulation du dialogue (§5.7).

**Rendu : l'export diffère de l'aperçu**
- L'alpha du texte et de l'ombre est ignoré à l'export : les couleurs `rgba` sortent opaques (§5.2).
- Vidéos de smartphone (rotation) écrasées, et orientation EXIF des photos ignorée à l'export (§5.2).
- Saccades : `floor(local_time*fps)` tombe sur la frame précédente dans 2 à 20 % des cas (§5.2).
- `letter_spacing` ignoré au retour à la ligne : texte coupé à droite (§5.2).

**Performance et mémoire**
- Export : chaque worker décode toute chaque vidéo et jette N-1 frames sur N, soit jusqu'à 8 décodages par vidéo (§5.1/5.2).
- Premier flux vidéo décodé en pleine résolution, et GIF gardés en entier par chaque worker (environ 17 Go dans le pire cas) (§5.2).
- Fusion de séquences réordonnées : mémoire ffmpeg non bornée (§5.3).
- Audio : jusqu'à 3 copies PCM complètes côté Rust (§5.3) et 3 côté WebView (§5.7).
- Bombe de décompression : un PNG de quelques Mo fait tuer toute l'application (§5.4).

**Multi-onglets et UX**
- Aperçu, annulation et progression de la vue Vidéo globaux : un onglet casse l'autre (§5.7).
- Touche Suppr de la timeline Vidéo active depuis les onglets masqués (§5.7).
- File d'export sans interface : `QueueManager` n'est jamais monté (§5.7).
- Scènes qui se chevauchent : la scène suivante est inatteignable (§5.6).

**Sécurité et distribution**
- Actions GitHub non épinglées dans le job qui reçoit la clé de signature de l'updater (§5.9).
- « Retirer l'EXIF » fait pivoter les photos portrait (et laisse le GPS dans les images MPF) (§5.4).

---

## 3. Outils automatiques et couverture de tests

### 3.1 Résultats

| Outil | Résultat |
|---|---|
| `tsc --noEmit` | ✅ 0 erreur |
| `eslint .` | ✅ 0 erreur, 10 warnings : 9 `react-refresh/only-export-components` (`CueEditor.tsx`, `videotool/components/Timeline.tsx`, `videotool/i18n.tsx`, `lib/menuBridge.tsx`, `suite/UpdaterProvider.tsx`) et 1 `react-hooks/exhaustive-deps` (`lib/menuBridge.tsx:106`, `ref.current` lu dans un cleanup) |
| `vitest run` | ✅ 123 fichiers, **2 507 tests passés** (89 s) |
| `cargo clippy --workspace --all-targets` | ✅ 0 warning |
| `cargo test --workspace` | ✅ **1 308 tests passés**, 6 ignorés |
| `npm audit --omit=dev` | ✅ 0 vulnérabilité |
| `cargo audit` | ⚠️ 0 CVE. 9 avertissements « unmaintained » (`paste`, `proc-macro-error`, `ttf-parser`, `zbus_names`, `zvariant`, `zvariant_derive`), tous transitifs via Tauri/GTK, et 1 « unsound » (`glib 0.18.5`, RUSTSEC-2024-0429, via `gtk 0.18` imposé par Tauri 2) |

**Remarques**
- La CI (`.github/workflows/ci.yml`) lance `lint`, `vitest` et `cargo test`, mais **ni clippy, ni `cargo fmt --check`, ni `prettier --check`, ni audit**. Les tests Rust ne tournent que sous Linux x86_64 (voir §5.9).
- La suite vitest est fragile sous charge. Avec l'instrumentation de couverture et une compilation en parallèle, 2 tests dépassent le délai de 5 s : `imagetool/test/Panels.session.test.tsx` (« does not apply when released without moving ») et `videotool/test/VideoTool.test.tsx` (« merges the chosen sequences… »). jsdom est recréé 123 fois, ce qui représente 48 % du temps. `pool: 'vmThreads'` ou `isolate: false` diviserait environ par deux la durée de la suite.

### 3.2 Couverture de tests

_Mesure en cours, cette section sera complétée._

---

## 4. Problèmes transverses

Plusieurs constats ont la même cause. Les traiter à la racine en corrige plusieurs d'un coup.

### 4.1 L'export diffère de l'aperçu (moteur Rust ≠ navigateur)
Le rendu d'export (`scene-core/raster.rs`, tiny-skia + cosmic-text + ffmpeg) réimplémente ce que fait la WebView. La fixture golden partagée garantit la parité des **calculs** d'animation, mais pas celle du **rendu**. Écarts relevés :
- alpha du texte et de l'ombre ;
- `letter_spacing` ;
- rotation des vidéos et orientation EXIF ;
- transition « blur » ;
- `line-reveal` ;
- base de calcul du Ken Burns ;
- couleur invalide rendue en blanc ;
- AVIF accepté à l'import mais non décodable ;
- liste de familles de police (seule la première est prise en compte) ;
- coupe horizontale du débordement de texte.

**Recommandation** : ajouter des tests de rendu de référence, par exemple une image PNG attendue par cas (texte rgba, letter-spacing, vidéo tournée, JPEG orienté), en s'appuyant sur l'infrastructure golden existante.

### 4.2 État global côté Rust partagé entre onglets
L'application garde plusieurs onglets Vidéo, Audio et Image montés en même temps (`App.tsx`, `TabPanel hidden`), mais le backend n'a qu'**un seul** emplacement pour chacun des éléments suivants :
- l'aperçu vidéo (`VideoState.preview`) ;
- le drapeau d'annulation vidéo (`fresh_cancel`) ;
- le drapeau d'export audio (`AudioExportControl`) ;
- le drapeau d'annulation des sous-titres (`subz::cancel`) ;
- les événements de progression (`video-preview-progress`, `audio-export-progress`, `pipeline-progress`), diffusés sans identifiant.

Conséquences (§5.5, §5.7) :
- un onglet supprime le fichier d'aperçu d'un autre, ce qui déclenche C2 ;
- « Annuler » dans un onglet annule les exports d'un autre ;
- les barres de progression mélangent deux travaux ;
- une annulation peut être effacée par le `reset()` d'une autre commande.

**Recommandation** : un identifiant d'opération par requête (`HashMap<OpId, (PathBuf, Arc<AtomicBool>)>`), passé par le front et repris dans chaque événement.

### 4.3 Sorties de l'application qui contournent les protections
Quatre chemins de sortie ont chacun leur propre logique, et aucun ne les couvre toutes :
- **Croix de fenêtre** : `closeGuard` + `runBeforeExit` ;
- **Ctrl+Q** : `exit(0)` direct ;
- **Croix d'onglet** : gardes Image/Vidéo uniquement ;
- **Mise à jour** : installation, puis demande de confirmation.

Côté Rust, `ExitRequested` n'attend que la génération de sous-titres : ffmpeg reste orphelin et des `.part` restent sur disque. La vue Audio n'a aucune garde.

**Recommandation** : un seul chemin « demande de sortie », qui interroge tous les onglets (en série, une seule boîte de dialogue), attend ou annule les travaux Rust, puis quitte.

### 4.4 Écriture des fichiers de sortie non protégée
| Sortie | Écriture |
|---|---|
| Audio, export de projet | `.part` + `rename` ✅ |
| Projet (`project.json`) | tmp + `rename`, mais sans `fsync` et avec un nom de fichier temporaire fixe |
| Export vidéo (vue Vidéo) | **directe**, avec `remove_file` en cas d'erreur ❌ (C1) |
| Export image, retrait d'EXIF | `fs::write` direct ❌ |

**Recommandation** : un utilitaire unique d'écriture atomique (`tempfile::NamedTempFile::new_in(dir)` + `persist`), et un refus systématique quand la sortie est égale à l'entrée (après `canonicalize`).

### 4.5 Fichiers lus en entier en mémoire
Fichiers lus d'un bloc :
- `read_media_file` / `preloadMedia` (C3) ;
- décodage audio Rust (3 copies) ;
- décodage audio WebView (3 copies) ;
- whisper sans VAD ;
- GIF par worker ;
- historique Image (1 Gio par onglet, sans plafond global).

Seul le streaming vidéo (`lvmedia`, `Range`) est fait proprement. Aucun budget mémoire global n'existe.

### 4.6 Modèle d'approbation des chemins incomplet
Les vues Audio et Vidéo et les sous-titres valident chaque chemin avec `Approved::check_input`/`check_output`. Les commandes suivantes ne le font pas :
- `export_project` / `export_project_audio` (sortie) ;
- `import_asset` (source) ;
- `load_project` (n'importe quel dossier contenant un `project.json`, avec un scope `asset:` récursif) ;
- `open_images_by_paths`.

La permission `store:default`, inutilisée par le front, permet d'écrire du JSON à n'importe quel chemin absolu. Exploiter ces points suppose d'exécuter du JS dans la WebView, ce que la CSP (`script-src 'self'`) rend difficile. Ils restent des défauts de défense en profondeur (§5.1).

---

## 5. Constats détaillés par module

Format : les constats critiques et hauts sont détaillés (problème, scénario, correctif) ; les moyens sont résumés ; les bas sont regroupés en tableau.

### 5.1 Backend Tauri — commandes, export, configuration (`src-tauri/src`)

Fichiers : `lib.rs`, `main.rs`, `menu_style.rs`, `commands/**`, `export/**`, `tauri.conf.json`, `capabilities/default.json`. Les noms et types d'arguments des `invoke` correspondent tous aux signatures Rust.

#### [Haute] TC-1 — Export : chaque worker décode **toute** chaque vidéo source
- **Fichiers** : `src-tauri/src/export/mod.rs:182-237` (entrelacement `first, first+step…`) ; `crates/scene-core/src/raster.rs:590-603` (`needs_reopen(idx, fps*2)`) ; `crates/scene-core/src/video.rs:139-160`.
- **Problème** : chaque worker (jusqu'à 8) a son propre `FrameRenderer`, donc son propre processus ffmpeg de décodage par élément vidéo. Il rend les frames `w, w+N, w+2N…`. Comme `N ≤ 8 < 2·fps`, le flux n'est jamais rouvert : `frame_at` lit, met à l'échelle, convertit en RGBA et transfère par pipe toutes les frames intermédiaires, puis en jette N-1 sur N. Les caches d'images, de texte et de polices (`FontSystem::new()`, `raster.rs:503`) sont eux aussi dupliqués dans chaque worker.
- **Scénario** : export 1080p d'un projet composé surtout de clips, sur 8 cœurs : 8 décodeurs traitent chacun 100 % du flux, soit environ 8 × 8 Mo par frame dans les pipes. L'export peut être plus lent qu'avec 2 workers.
- **Correctif** : donner à chaque worker des **blocs contigus** de frames (worker k → `[k·T/N, (k+1)·T/N)`), avec un réordonnancement borné par `MAX_PENDING_FRAME_BYTES`, ou décoder chaque vidéo une seule fois et partager les frames (`Arc<Pixmap>`). Partager aussi une seule `fontdb::Database`, et recycler les buffers de `Pixmap`.

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| TC-2 | **Sécurité.** `store:default` est inutilisé par le front, mais il expose `load`/`set`/`save` au JS. Comme `PathBuf::push` accepte un chemin absolu, il permet d'écrire du JSON n'importe où. Combiné à `load_project`, qui accepte tout dossier contenant un `project.json` et ouvre `asset:` en récursif, cela rend tout `$HOME` lisible. | `capabilities/default.json:15`, `commands/project.rs:229-244`, `registry.rs:266-275` | Retirer `store:default`. N'accepter dans `load_project` que des dossiers venus d'un dialogue natif, d'un dépôt de fichier ou des récents. |
| TC-3 | **Sécurité.** Les chemins de `export_project*` (sortie, `rename` qui écrase), `import_asset` (copie de n'importe quel fichier média) et `add_output_to_projects` échappent à `Approved`. La sortie n'est pas préfixée par `file:` pour ffmpeg (une URL `http://…` serait interprétée comme telle). | `commands/export.rs:56,75,105,116`, `export/mod.rs:329-352`, `commands/assets.rs:104-136`, `media_subs.rs:187-229` | `check_output`/`check_input`, `OpenProjects::require`, préfixe `file:`. |
| TC-4 | Quitter pendant un export laisse ffmpeg orphelin et des `.part` sur disque. Seuls les sous-titres sont attendus à `ExitRequested`. Dans la vue Vidéo, le fichier final reste tronqué. | `lib.rs:181-206`, `export/ffmpeg.rs:551-558`, `video_tool.rs:86-137` | `prevent_exit()`, annuler puis attendre (avec un délai maximal). Nettoyer les `.part` orphelins au démarrage. |
| TC-5 | Course dans `video_preview` : un aperçu annulé remet `state.preview = None` sans vérifier que c'est encore son fichier. Le WebM suivant (plusieurs Go) reste dans `/tmp`. | `video_tool.rs:310-319,342,362-365` | Ne remettre à `None` que si la valeur est encore `out`. |
| TC-6 | Le protocole `lvmedia` est **synchrone**, donc il tourne sur le thread GTK principal : 2 `canonicalize` et une lecture jusqu'à 8 Mio par requête `Range`, d'où des saccades de l'interface. | `lib.rs:67-77`, `media_protocol.rs:15,100-134` | `register_asynchronous_uri_scheme_protocol` + pool de threads, et `MAX_CHUNK` à 1-2 Mio. |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| TC-7 | `import_stock_asset` : la règle « https uniquement » se contourne par redirection, aucun hôte n'est imposé, `Content-Type` non vérifié | `commands/stock.rs:91-100,555-591` |
| TC-8 | CSP : `img-src https:` / `media-src https: http://127.0.0.1:*` laissent des canaux d'exfiltration ; les jetons du serveur média ne sont jamais révoqués (`Access-Control-Allow-Origin: *`) | `tauri.conf.json:23`, `media_server.rs:46-53,102` |
| TC-9 | Sauvegarde projet : pas de `fsync`, nom temporaire fixe `project.json.tmp`, `.bak` créé par `fs::copy` non atomique | `commands/project.rs:67-83` |
| TC-10 | Imports concurrents : `unique_destination` teste `exists()` trop tôt ; `with_extension("part")` donne le même `.part` pour `x.jpg` et `x.png` | `stock.rs:582-591`, `assets.rs:73-99,135-136`, `media_subs.rs:201-202` |
| TC-11 | Fichiers temporaires à noms prévisibles dans `/tmp` (`lev_export_*`, `lev_preview_*`, `lev_merge_*`, `lev_subs_mix_*`), jamais nettoyés après un plantage | `video_tool.rs:140-151,334-341,576-611`, `subs_tool.rs:95-101` |
| TC-12 | Surcharges `width`/`height`/`fps` de l'export non bornées : export interminable, ou `Pixmap::new(...).expect` qui panique | `commands/export.rs:14-19,67-74`, `export/mod.rs:169-172,312-324` |
| TC-13 | `Mutex::lock().unwrap()` sur des états partagés (empoisonnement possible, y compris dans `VideoState::shutdown`) | `video_tool.rs` (≈15 sites), `launch.rs:182,201`, `media_server.rs:51,132-134` |
| TC-14 | `load_project` retombe silencieusement sur `project.json.bak`, que l'autosave écrase ensuite | `project.rs:55-62,237` |
| TC-15 | Les récents sont purgés définitivement quand un disque est temporairement absent | `project.rs:327-341` |
| TC-16 | `audio_pick_output` : l'extension est ajoutée après le dialogue, donc un fichier peut être écrasé sans confirmation | `audio_tool.rs:191-195` |
| TC-17 | Progression à 100 % pendant la finalisation (`+faststart`), et annulation ignorée à ce moment-là | `export/mod.rs:257-283`, `export/ffmpeg.rs:382-396,543-548` |
| TC-18 | `lvmedia://` échoue pour un nom contenant `::` (`rsplit_once`) | `media_protocol.rs:97` |
| TC-19 | Travail bloquant (ffprobe, trousseau D-Bus, E/S) sur le runtime async ou dans des commandes synchrones, donc sur le thread principal | `video_tool.rs:307,322,783-795`, `audio_tool.rs:218-237`, `stock.rs:485-487`, `media_subs.rs:102-177`, `media_server.rs:169-191` |
| TC-20 | `video_frames` : jusqu'à 200 ffmpeg lancés **en série**, et 200 JPEG en base64 dans une seule réponse IPC. ffprobe est relancé pour chaque occurrence d'un même clip avant l'export. | `video_tool.rs:417-424,470-503`, `export/mod.rs:122-147` |

---

### 5.2 `crates/scene-core` — rendu des frames

Modèle `Project → Composition → Element` (ts-rs, identique à `src/bindings`). Les ports Rust de `timeline.ts` et `animate.ts` sont vérifiés par la fixture golden. Le rendu `raster.rs` utilise tiny-skia et cosmic-text, avec un décodage vidéo en flux via ffmpeg.

#### [Haute] SC-1 — L'alpha de la couleur du texte et de l'ombre est ignoré à l'export
- **Fichiers** : `raster.rs:1075-1082`, `:1109-1128`, `:1199-1233` (et `cosmic-text-0.19.0/src/swash.rs:208-216`).
- **Problème** : pour les glyphes `Content::Mask`, cosmic-text construit la couleur avec `(coverage << 24) | base & 0xFFFFFF` : l'alpha demandé est **remplacé** par la couverture du glyphe. Le souligné et le barré utilisent, eux, l'alpha réel, d'où une incohérence au sein d'un même texte.
- **Scénario** : les presets de `src/lib/elements.ts` (`rgba(255,255,255,0.85)`, `text_shadow: rgba(0,0,0,0.9)`) apparaissent translucides en aperçu et opaques à l'export. Un texte en `rgba(0,0,0,0)` est dessiné en noir plein. Le test `text_shadow_is_blurred_and_offset` passe par hasard.
- **Correctif** : dans la closure de `paint_glyphs`, multiplier la couverture par l'alpha d'origine. Ajouter un test sur un texte à alpha 0,5.

#### [Haute] SC-2 — Vidéos de smartphone (métadonnée de rotation) déformées à l'export
- **Fichiers** : `video.rs:21-63,97-109` ; `raster.rs:597-602,621`.
- **Problème** : `probe_video` lit les dimensions **codées** (`stream=width,height`), sans la display matrix ni le tag `rotate`. Or ffmpeg applique l'autorotation au décodage. L'image portrait est donc forcée par `scale={w}:{h}` dans des dimensions paysage, puis ajustée avec un ratio paysage.
- **Scénario** : vidéo iPhone 1920×1080 avec rotation de -90° : correcte en aperçu, écrasée à l'export. Le `crop` devient aussi incohérent.
- **Correctif** : lire `stream_side_data=rotation` et `stream_tags=rotate`, et permuter largeur et hauteur quand la rotation vaut ±90° ou 270°.

#### [Haute] SC-3 — Orientation EXIF des photos ignorée à l'export
- **Fichier** : `raster.rs:274` (`image::open(path)?.to_rgba8()`).
- **Problème** : avec `image` 0.25, `open`/`decode` n'appliquent pas l'orientation. Le navigateur, lui, l'applique (`image-orientation: from-image`).
- **Scénario** : photo portrait de téléphone (`Orientation=6`) : droite en aperçu, couchée à 90° à l'export.
- **Correctif** : `ImageReader::open(p)?.with_guessed_format()?.into_decoder()`, puis `decoder.orientation()` et `img.apply_orientation(o)`.

#### [Haute] SC-4 — Index de frame vidéo décalé d'une image (troncature flottante), d'où des saccades
- **Fichiers** : `raster.rs:373`, `:844-845`, `:588` (avec `t = idx / fps` dans `export/mod.rs:196`).
- **Problème** : `raw_idx = (local_time * fps).floor()`. Les erreurs IEEE donnent `k − ε`, donc `k − 1`. Vérifié en double précision : `floor((123/30)*30) = 122`. Sur 20 000 indices, 404 sont faux (début de scène à 0, 30 fps), 650 (début à 5 s), 3 934 (début à 0,1 s), 1 145 à 25 ou 50 fps.
- **Scénario** : une frame dupliquée puis une frame sautée, plusieurs fois par seconde, visibles sur tout mouvement de caméra.
- **Correctif** : `(local_time * fps + 1e-6).floor()`, ou calcul de l'index en entier quand `speed == 1`.

#### [Haute] SC-5 — `letter_spacing` ignoré au retour à la ligne et à l'auto-fit, donc texte coupé à droite
- **Fichiers** : `raster.rs:1002-1049`, `:1102-1116`, `:1164`, `:1185-1192`.
- **Problème** : cosmic-text fait le retour à la ligne sans l'espacement, qui est ajouté ensuite glyphe par glyphe. Le calque fait `w_px + 2·halo` et les pixels au-delà sont jetés. L'auto-fit (`measure`, clé de cache) ignore aussi l'espacement. La preview, elle, l'inclut (`ElementViews.tsx:35`).
- **Scénario** : « BIENVENUE À TOUS » avec `letter_spacing: 1` : 2 lignes en aperçu, 1 ligne trop large à l'export, dernières lettres coupées.
- **Correctif** : appliquer l'espacement dans la mise en page (`Attrs::letter_spacing` si disponible, sinon mise en page sur une largeur réduite), et l'inclure dans `measure` et dans la clé d'auto-fit.

#### [Haute] SC-6 — Le premier flux vidéo est décodé en pleine résolution pendant tout le clip
- **Fichiers** : `raster.rs:861-866`, `:590-602`.
- **Problème** : `target_scale` est calculé depuis `self.probes`, **vide au premier appel**, donc l'échelle vaut 1. Le flux n'est rouvert qu'en cas de saut ou de boucle.
- **Scénario** : rush 4K à 25 % de la largeur d'un export 1080p : 33 Mo par frame dans le pipe au lieu d'environ 0,5 Mo, puis une réduction bilinéaire ×8 sans mipmap, d'où une image crénelée et scintillante.
- **Correctif** : faire la sonde **avant** de calculer `target_scale`.

#### [Haute] SC-7 — GIF animés : jusqu'à 600 frames pleine taille en mémoire, multipliées par le nombre de workers
- **Fichiers** : `raster.rs:75`, `:205-219`, `:278-301`.
- **Scénario** : GIF de 30 s en 1280×720 à 20 fps : environ 2,2 Go par worker, soit environ 17 Go avec 8 workers. OOM ou swap.
- **Correctif** : budget en octets, frames stockées à la taille affichée, décodage à la volée avec un petit cache, frames partagées entre workers (`Arc`).

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| SC-8 | La transition de scène « Blur » n'a pas de flou à l'export (`blur_px: 0.0` forcé) | `raster.rs:676-690` | Appliquer `box_blur` au buffer de scène |
| SC-9 | `line-reveal` : la preview tronque puis recentre, l'export masque les lignes sans recentrer, d'où un décalage vertical | `raster.rs:930-937,1099-1101,1153-1160` vs `animate.ts:237-238` | Tronquer le contenu comme pour typewriter |
| SC-10 | Couleur CSS invalide → blanc opaque (le navigateur l'ignore) : `""`, `"none"` en remplissage, `currentColor`. Cas fréquent avec l'import legacy | `color.rs:162-164`, `raster.rs:1171-1179,1514-1542,1642,1690` | `try_parse_css_color`, et transparent en cas d'échec |
| SC-11 | Ken Burns en `fit-width`/`fit-height` : translation calculée sur la boîte au lieu de l'image, donc 3× plus faible à l'export | `raster.rs:1650-1651` vs `animate.ts:385-391` | Multiplier par `scaled_w`/`scaled_h` |
| SC-12 | AVIF et `.jpe` acceptés à l'import mais non décodables à l'export. BMP fonctionne seulement par unification de features | `scene-core/Cargo.toml:17`, `raster.rs:274`, `assets.rs:46-48` | Déclarer les features, `with_guessed_format()`, ou retirer ces extensions |
| SC-13 | Cache de calques limité à 48 entrées sans limite d'octets, en **FIFO** : les clés éphémères (typewriter, blur) chassent les calques statiques. Jusqu'à 1,6 Go par worker en 4K | `raster.rs:72-73,127-152,947-967` | LRU + budget en octets |
| SC-14 | `draw_bitmap` réalloue calque et masque et fait 2 passes plein cadre à chaque frame, même pour une image statique | `raster.rs:1610-1714` | Passer par `LayerCache` quand il n'y a ni pan ni flou |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| SC-15 | Vidéo sondée mais non décodable : placeholder gris silencieux, absent de `missing_media` | `raster.rs:612-620`, `video.rs:139-160` |
| SC-16 | Vidéos avec alpha : RGBA droit stocké dans un `Pixmap` prémultiplié, d'où des franges claires | `video.rs:69-70,112-113,153` |
| SC-17 | `Pixmap::new(w,h).expect` panique sur des dimensions de projet énormes | `raster.rs:627,726` |
| SC-18 | `font_family` : seule la première famille de la liste CSS est prise en compte | `raster.rs:385-399` |
| SC-19 | Fondu-enchaîné fade out + fade in : creux de luminosité de 25 % au milieu (aperçu et export identiques) | `raster.rs:633-641,673,729-736` |
| SC-20 | Flip, FlipH et FlipV ne retournent pas l'image (échelle uniforme seulement) | `animate.rs:303-306,468-472` |
| SC-21 | Le débordement horizontal du texte et de son ombre est coupé par le calque | `raster.rs:1164,1189-1210` |
| SC-22 | Vidéo de durée inconnue (`N/A`) : la boucle ne fonctionne jamais et l'image reste figée | `raster.rs:376,583-587` |
| SC-23 | `box_blur` : 3×(H+W) allocations par flou, copie complète à chaque passe, passe verticale peu favorable au cache | `raster.rs:1279-1352` |
| SC-24 | JSON des filtres vidéo reparsé à chaque frame pour chaque vidéo | `video_fx.rs:220-231`, `raster.rs:324-330,860` |
| SC-25 | `FontSystem::new()` (scan des polices système) répété dans chaque worker | `raster.rs:503-507` |

---

### 5.3 `crates/audio-dsp` et `crates/video-export`

Le DSP est mathématiquement correct : biquads RBJ, Butterworth en cascade, fondus sin/cos, dither TPDF, compensation de la latence de rubato. Les commandes ffmpeg sont construites en tableaux d'arguments, sans shell, avec un échappement correct des chemins dans les graphes de filtres.

#### [Critique] AV-1 — Exporter une vidéo vers son propre fichier source efface la source
- **Fichiers** : `crates/video-export/src/export.rs:166-170,217-225` ; `src-tauri/src/commands/video_tool.rs:126-137` (`remove_file(&options.output_path)` sur toute erreur), `:283` (`allow_output` sans comparaison avec l'entrée), `:669-676` (`prepare`).
- **Problème** : rien n'empêche `output_path == input_path`. ffmpeg refuse de démarrer (« Output … same as Input #0 »), même avec `-y`, et `run_job` supprime alors `output_path`, c'est-à-dire la source. Si les deux chemins désignent le même fichier par des chaînes différentes (lien symbolique, casse sous macOS), ffmpeg ne détecte rien et tronque la source pendant qu'il la lit.
- **Scénario** : ouvrir `~/Vidéos/clip.mp4`, couper, exporter en MP4, garder le nom `clip.mp4` et confirmer l'écrasement. L'export échoue, puis `clip.mp4` est **supprimé définitivement**.
- **Correctif** : dans `prepare`, refuser une sortie dont le `canonicalize` égale celui de l'entrée. Écrire dans un `.part` du même dossier puis faire un `rename`. Ne jamais supprimer `output_path`.

#### [Haute] AV-2 — L'export vidéo écrit directement dans la destination
- **Fichiers** : `export.rs:166-170,224,252-256` ; `video_tool.rs:128-135`.
- **Problème** : `-y` tronque la destination dès l'ouverture, et l'appelant la supprime sur toute erreur, y compris avant tout encodage (échec de `probe`).
- **Scénario** : réexporter `montage.mp4` par-dessus la version de la veille, puis annuler à 80 % : l'ancienne version est perdue et la nouvelle n'existe pas.
- **Correctif** : un fichier `.part` temporaire + `rename`, comme `audio.rs:190-231`.

#### [Haute] AV-3 — Fusion de séquences réordonnées : mémoire non bornée dans ffmpeg
- **Fichier** : `crates/video-export/src/sequences.rs:95-143`.
- **Problème** : toutes les séquences sont des branches `trim` d'une seule entrée décodée dans l'ordre du fichier, et `concat` les consomme dans l'ordre choisi. Placer une séquence tardive en premier oblige ffmpeg à garder en RAM toutes les images décodées qui la précèdent.
- **Scénario** : film d'une heure en 1080p, plan 58:00–60:00 placé en tête : plusieurs dizaines de Go, puis l'OOM-killer.
- **Correctif** : une entrée par séquence (`-ss start -t durée -i input`), puis `concat`.

#### [Haute] AV-4 — Chaîne audio : jusqu'à 3 copies PCM complètes, et un cache jamais libéré
- **Fichiers** : `audio-dsp/src/pipeline.rs:48-84,187` ; `ops/speed.rs:51-53`.
- **Scénario** : à 48 kHz stéréo en f32, 1 h fait 1,38 Go par copie. Un podcast de 3 h avec changement de vitesse dépasse 12 Go. Les 4 Go du dernier fichier restent occupés après sa fermeture.
- **Correctif** : construire la copie de travail à partir des plages conservées, libérer l'entrée après `change_speed`, et vider le cache à la fermeture de l'outil.

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| AV-5 | « 1080p » sur une vidéo portrait 1080×1920 donne 608×1080 : la résolution est appliquée en hauteur max au lieu du petit côté | `video_filters.rs:96-98,165-169` | Toujours utiliser `short_side_filter` |
| AV-6 | Coupes audio recollées sans fondu, d'où un clic à chaque raccord (aussi dans l'aperçu) | `ops/trim.rs:84-96`, `previewEngine.ts:199-218` | Micro-fondu enchaîné de 5 à 10 ms |
| AV-7 | MP3 non gapless (`enable_gapless: false`) : silence de tête cumulé à chaque réexport, décalage avec l'aperçu (`decodeAudioData`) | `audio.rs:91` | `FormatOptions { enable_gapless: true, .. }` |
| AV-8 | `.ogg`, `.mka` et `.webm` proposés, mais symphonia ne décode pas l'Opus | `pipeline.rs:87-89` | Repli sur ffmpeg (f32le sur un pipe) ou retrait des extensions |
| AV-9 | Sous-titres gravés : **deux encodages complets**, audio réencodé deux fois en webm/avi, qualité audio forcée à 192k en mp4/mov | `export.rs:162-259`, `plan.rs:676-681,723-728` | Calculer les dimensions finales avant, puis une seule passe |
| AV-10 | Pas de `-ss` avant `-i` : tout ce qui précède le premier segment est décodé (deux fois avec la stabilisation) | `plan.rs:495-548`, `export.rs:148-149,198-201` | `-ss {start - marge}` en entrée |
| AV-11 | Vignettes de la frise : `fps=count/duration` décode **toute** la vidéo | `preview.rs:79-95` | Recherche par vignette, ou `-skip_frame nokey` |
| AV-12 | Aperçu transcodé (HEVC, 10 bits…) en VP9 à la résolution d'origine | `preview.rs:44-71` | Limiter à 720p ou 1080p |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| AV-13 | Échappement ASS : `\` devient `\\`, que libass affiche tel quel ; `\r` isolé non filtré, qui coupe la ligne `Dialogue:` | `subtitles.rs:78-83` |
| AV-14 | `setpts={:.4}` (vitesse vidéo arrondie) vs `atempo` exact : jusqu'à 120 ms de désynchronisation par heure en 3× | `video_filters.rs:87-93`, `plan.rs:577-582` |
| AV-15 | `[0:v]` peut désigner une pochette (`attached_pic`) | `plan.rs:502,544`, `export.rs:99-105` |
| AV-16 | Facteur de vitesse audio non borné côté Rust, d'où une allocation géante puis un *abort* | `ops/speed.rs:13-27,44-53` |
| AV-17 | Réservation mémoire calquée sur le `n_frames` de l'en-tête (WAV en flux : 2 Go réservés pour 5 s) | `audio.rs:103,140` |
| AV-18 | Segments vidéo chevauchants ou hors durée acceptés : contenu dupliqué, progression faussée | `plan.rs:231-240` |
| AV-19 | Stabilisation mesurée à travers les raccords : ondulation du cadre autour de chaque coupe | `plan.rs:495-514,566-568` |
| AV-20 | Détection de plans en pleine résolution (10 à 20× trop lent) | `sequences.rs:20-34` |
| AV-21 | DSP sur un seul cœur (filtres, rubato canal par canal) ; ASS quadratique pour typewriter et mot surligné | `ops/filter.rs:307-314`, `ops/speed.rs:60-74`, `subtitles.rs:51-76,207-232` |

---

### 5.4 Backend vue Image (`src-tauri/src/imgz`)

Historique d'images complètes par onglet (`Arc<DynamicImage>`, budget de 1 Gio et 100 étapes par onglet), aperçu sur une vignette de 1024 px, image servie par `lcimg://`. Le verrou est relâché pendant le calcul et le pipeline est générique 8/16 bits.

#### [Haute] IM-1 — Bombe de décompression : la limite `max_alloc` d'`image` est contournée
- **Fichier** : `open.rs:120-133`.
- **Problème** : `into_decoder()` + `DynamicImage::from_decoder()` ne réservent jamais le tampon de sortie (seul `ImageReader::decode()` le fait). `MAX_SIDE`/`MAX_PIXELS` ne s'appliquent qu'aux images produites, pas à l'ouverture.
- **Scénario** : un PNG de quelques Mo déclarant 60 000 × 60 000 px provoque une allocation d'environ 14 Go, puis l'OOM-killer emporte **toute l'application**, onglets vidéo et projets non sauvegardés compris.
- **Correctif** : `reader.limits(...)` avec `max_image_width/height = MAX_SIDE` et `max_alloc` ≈ 1 Gio, plus `check_dims` avant `from_decoder`.

#### [Haute] IM-2 — « Retirer l'EXIF » sans perte fait perdre l'orientation (photos portrait couchées) et laisse des métadonnées
- **Fichiers** : `exif.rs:87-100`, `open.rs:129-135`.
- **Problème** : pour un JPEG non retouché, `write_stripped` réécrit le fichier **source**, dont les pixels sont couchés, et supprime tout l'EXIF, y compris `Orientation`. De plus, `img-parts` recopie tel quel tout ce qui suit le premier SOS, dont les images secondaires MPF (gain maps, souvent avec GPS), l'Extended XMP et les segments COM.
- **Scénario** : photo portrait de smartphone (cas majoritaire) : le fichier produit s'affiche tourné de 90°. Une photo Pixel ou iPhone avec gain map garde son GPS.
- **Correctif** : réinsérer un EXIF minimal avec `Orientation` (le test `exif.rs:224-231` fabrique déjà ce bloc), ou ré-encoder l'image décodée. Supprimer tous les APPn sauf APP0, ICC et APP14, ainsi que les COM, et tronquer après l'EOI.

#### [Haute] IM-3 — `reset_tool` rejoue des étapes à coordonnées absolues dans un repère qui n'est plus le bon
- **Fichiers** : `ops.rs:190-209`, `steps.rs:586-596`.
- **Scénario** : recadrage 1000×1000, puis redimensionnement 500×500, puis « réinitialiser le recadrage » : l'image 4000×3000 est écrasée en 500×500, avec `dropped = 0`. Une gomme rejouée après réinitialisation d'un redimensionnement efface une zone sans rapport.
- **Correctif** : abandonner (et compter dans `dropped`) toute étape géométrique ou `Inpaint` postérieure à une étape retirée qui change la géométrie, ou stocker des coordonnées relatives.

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| IM-4 | **Sécurité.** `open_images_by_paths` lit n'importe quel chemin, sans `Approved` | `open.rs:203-209`, `exif.rs:30` | `check_input` / `allow_input` |
| IM-5 | Course entre un calcul en cours et Annuler/Rétablir : `commit` empile sur l'index **courant**, ce qui fait réapparaître un effet annulé. Ctrl+Z n'est pas bloqué par `isLoading`, qui est un booléen partagé | `ops.rs:118-165`, `ImageTool.tsx:268-270,318-330`, `useImageEditor.ts:154-164,284-296` | Capturer `(epoch, index)` et refuser le commit s'ils ont changé ; bloquer undo/redo pendant le calcul ; remplacer le booléen par un compteur |
| IM-6 | Redimensionnement (Lanczos3) et rotation libre en alpha **non prémultiplié** : halos sombres | `transform.rs:72,205-226` | `premultiply`/`unpremultiply` existent déjà dans `imaging.rs` |
| IM-7 | Profil ICC CMYK ou Gris réinjecté sur des données RGB | `open.rs:132`, `export.rs:106-107`, `imaging.rs:76-78` | Vérifier l'espace de l'en-tête ICC (octets 16-19) |
| IM-8 | Vignettes des préréglages en CSS ≠ rendu du backend (Froid, Lomo, Croquis) | `FiltersPanel.tsx:47-93,501` vs `filters.rs:236-343` | Générer les vignettes côté backend |
| IM-9 | Aperçu réduit non représentatif pour le débruitage, le grain, le croquis et la pixellisation (`Op::scaled` incomplet) | `pipeline.rs:201-225`, `adjustments.rs:367,400-402`, `filters.rs:124-138,215` | Compléter `scaled()` (Pixelate : pas en dessous de 2) |
| IM-10 | Aperçus servis sans profil ICC (une photo P3 ou Adobe RGB paraît désaturée) ; profil perdu à l'export TIFF | `open.rs:52-65`, `export.rs:61` | Injecter l'ICC dans les PNG servis ; tag 34675 pour TIFF |
| IM-11 | Toutes les métadonnées (EXIF, XMP, IPTC) sont perdues à l'export, sans avertissement | `export.rs:71-110` | Réinjecter l'EXIF avec `Orientation=1` |
| IM-12 | `lcimg` : encodage PNG **pleine résolution** à chaque étape, un thread par requête, sans cache ni annulation. La pipette et la copie ré-encodent à nouveau | `image_protocol.rs:27-58,311-330`, `lib.rs:58-66` | Version adaptée à l'écran, LRU par `(onglet, epoch, index)`, pool borné, `Cache-Control: immutable` |
| IM-13 | `preview_command` refait `thumbnail(1024)` de l'image complète à chaque mouvement de curseur, résultat en base64 | `pipeline.rs:245-262` | Mettre en cache la vignette de travail, servir sans base64 |
| IM-14 | Inpaint mono-thread, avec `unknown.iter().any()` sur **toute** l'image à chaque passe | `inpaint.rs:56,117-130,144-190` | Limiter à la `MaskBox`, paralléliser le front |
| IM-15 | Conversions RGBA systématiques, 3 copies pour `sharpen`/`blur`, budget de 1 Gio **par onglet** sans plafond global | `imaging.rs:76-104,227-231`, `adjustments.rs:366-369`, `imgz/mod.rs:13-15,92-101` | Garder RGB8/L8, travailler en place, budget global LRU |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| IM-16 | Pixelisation, flou de mouvement et flou radial ignorent l'alpha | `filters.rs:157-169,380-435` |
| IM-17 | Inpaint sans pixel connu adjacent : étape vide mais « réussie » | `inpaint.rs:64-66,144-162` |
| IM-18 | Retrait d'EXIF : chemin sans perte choisi d'après l'extension, et non le contenu | `exif.rs:85-91` |
| IM-19 | Écriture non atomique à l'export et au retrait d'EXIF | `export.rs:109`, `exif.rs:100` |
| IM-20 | Onglet fermé pendant le décodage : historique jamais libéré (environ 200 Mo) | `open.rs:166-171`, `ImageTool.tsx:259-265` |
| IM-21 | Balance des blancs, flou et redimensionnement en espace gamma | `adjustments.rs:342-356`, `imaging.rs:209-232` |
| IM-22 | Boucles pixel séquentielles (blur σ≤4, Lanczos3, pixelate, `flatten_on_white` avec `put_pixel`) | `imaging.rs:218-222`, `transform.rs:72`, `filters.rs:157-163`, `export.rs:34-43` |
| IM-23 | Vignette de 160 px recalculée et encodée en base64 à chaque navigation dans l'historique | `open.rs:91-95`, `ops.rs:46-58,149` |

---

### 5.5 Génération de sous-titres (`src-tauri/src/subz`)

Module solide : modèles épinglés sur un commit et vérifiés par SHA-256 **avant** le `rename`, reprise `Range`, clés en `Zeroizing` transmises dans les en-têtes, aucun découpage par octets (UTF-8 sûr), annulation prise en compte partout. **Aucun constat critique ni haut.**

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| SZ-1 | `wrap_line` : dès qu'un mot dépasse 42 colonnes (une URL, par exemple), il garde le **dernier** essai, soit un mot par ligne. Complexité d'environ O(n⁵) : un paragraphe collé peut figer un cœur pendant des heures, sans annulation possible | `pipeline/subtitle_writer.rs:98-143` | Garder le meilleur coût, borner `lines`, largeurs cumulées, glouton au-delà d'environ 50 unités |
| SZ-2 | Langue détectée hors des 26 langues listées (catalan, norvégien, cantonais…) ou `unknown` : **traduction impossible**, même avec DeepL, Google ou Azure, qui détectent la langue seuls | `pipeline/mod.rs:408-428`, `GenerateSubtitlesDialog.tsx:229-264` | Source non listée → `None` pour les moteurs cloud, exigée seulement pour NLLB |
| SZ-3 | whisper local : la langue est figée sur le **premier** bloc VAD, qui peut durer 0,1 s (un jingle, un « OK ! ») | `stt/local_whisper.rs:326,340,366-369` | Détecter sur environ 30 s de parole concaténée |
| SZ-4 | **(à confirmer par un appel réel)** OpenAI/Groq : le texte du segment est reconstruit à partir de `words[]`, au risque de perdre la ponctuation | `stt/openai_compatible.rs:127-157`, `stt/mod.rs:43-58` | N'utiliser `words` que pour les temps |
| SZ-5 | Client HTTP sans délai de lecture : 30 min × 4 tentatives sur une connexion bloquée, soit environ 2 h figé | `http.rs:14,21-23,53,183-186` | Délai de lecture de 60 à 120 s, keepalive, pas de nouvelle tentative après un délai total épuisé |
| SZ-6 | Sans VAD, ou sur une longue parole continue, tout l'audio est chargé en f32 (460 Mo pour 2 h) | `stt/local_whisper.rs:178-229,305-337` | Découper systématiquement en blocs de 120 s au plus |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| SZ-7 | Intégrité d'un modèle déjà présent contrôlée **par la taille seulement** avant son chargement par du code natif | `download.rs:75-96`, `models.rs:83-99` |
| SZ-8 | L'annulation n'arrête pas l'upload cloud en cours (facturé) ; AssemblyAI garde la transcription | `http.rs:107-140`, `stt/assemblyai.rs:213-220` |
| SZ-9 | Répliques de durée nulle (même `start`), donc invisibles | `pipeline/segmentation.rs:159-176` |
| SZ-10 | Dernier morceau cloud de moins de 0,1 s : erreur 400, et toute la transcription échoue | `audio_extract.rs:209-231`, `stt/openai_compatible.rs:186-197` |
| SZ-11 | `cancel::reset()` global : une annulation arrivée avant le démarrage est perdue, et deux exécutions simultanées restent possibles | `cancel.rs:7,32-34`, `pipeline/mod.rs:60,299-300,439-440`, `subs_tool.rs:136,162` |
| SZ-12 | Nouvelles tentatives sur des POST non idempotents (double facturation, jobs AssemblyAI en double) | `http.rs:66-68,172-186`, `stt/assemblyai.rs:198-208` |
| SZ-13 | Hors ligne : erreurs de téléchargement sans code traduisible ; VAD abandonnée sans le dire après 8 s | `download.rs:112-119`, `pipeline/mod.rs:360-366` |
| SZ-14 | `find_silences` et `media_duration_secs` non annulables ; dossier `scratch` hors du nettoyage au démarrage | `audio_extract.rs:254-295`, `stt/openai_compatible.rs:182`, `lib.rs:9-10,187-199` |
| SZ-15 | Modèles whisper et NLLB (environ 1,5 à 2 Go) gardés en mémoire toute la session | `stt/local_whisper.rs:61-96`, `translate/local_nllb.rs:186-234` |
| SZ-16 | Appel au trousseau (D-Bus, invite de déverrouillage) sur un worker Tokio | `pipeline/mod.rs:78-88,185,213` |

---

### 5.6 Frontend éditeur de projet

Fichiers : `App.tsx`, `Root.tsx`, `AppMenuBar.tsx`, `components/*.tsx`, `components/editor/**`, `lib/**`. Horloge de lecture hors de React, historique pur avec partage structurel, autosave sérialisé, `listen()` correctement désabonnés. **i18n : 924 clés en, 924 clés fr, aucune manquante.**

#### [Critique] ED-1 — `preloadMedia` lit chaque vidéo entière en mémoire, et recommence à chaque modification du projet
- **Fichiers** : `src/components/Editor.tsx:330-338` ; `src/lib/mediaCache.ts:24,37-57,64-106,111-114` ; `src-tauri/src/commands/assets.rs:15-30` ; `src/lib/useMediaSource.ts:48`.
- **Problème** : l'effet dépend de `[project, activeId, projectDir]`, donc il tourne à **chaque mutation** (chaque `pointermove` d'un drag, chaque frappe). Pour chaque vidéo de la scène active et de la suivante, `readMediaFile` fait un `fs::read` du fichier complet, puis l'IPC crée un `ArrayBuffer` et un `Blob`. Ce blob ne sert qu'**en repli** : la lecture normale passe par `lvmedia://` en `Range`. Au-delà de `IDLE_BUDGET_BYTES` (384 Mo), `evictIdle` le jette aussitôt et il est relu à la mutation suivante. `read_media_file` n'a aucune limite de taille.
- **Scénario** : projet avec une vidéo 4K de 2 Go. Déplacer un titre à la souris lit 2 Go (environ 4 Go de pic Rust + JS), les jette, puis recommence en boucle pendant le drag. Disque saturé, saccades, OOM de la WebView.
- **Correctif** : supprimer l'appel à `preloadMedia` (le flux `Range` suffit), ou le réserver au mode repli blob. À défaut, ne dépendre que des `src` et ne jamais précharger au-delà du budget. Côté Rust, refuser `read_media_file` au-delà d'un seuil.

#### [Haute] ED-2 — Fermer un onglet projet par la croix contourne la protection d'enregistrement
- **Fichiers** : `src/App.tsx:62-66,119` ; `Editor.tsx:156-169,574`.
- **Problème** : `closeTab` ne consulte un garde que pour les onglets Image et Vidéo. Pour un projet, la seule écriture est un `void flushRef.current()` au démontage. En cas d'échec, `setSaveError` vise un composant démonté et rien n'est affiché. Ctrl+W, lui, garde l'onglet ouvert en cas d'échec. Un export en cours perd aussi son `markBusy`.
- **Scénario** : projet sur une clé USB retirée, clic sur × : l'onglet disparaît et le travail est perdu sans message.
- **Correctif** : faire enregistrer par l'Editor un `registerCloseGuard` qui renvoie `await flush()` et refuse la fermeture en cas d'échec ou d'export en cours.

#### [Haute] ED-3 — Éditeur de sous-titres liés resté ouvert en changeant de vidéo : textes de A écrits sur B
- **Fichiers** : `editor/PropertiesPanel.tsx:139-145` ; `editor/properties/LinkedSubtitlesFields.tsx:22,56-63` ; `subtitles/CueEditor.tsx:76`.
- **Problème** : pas de `key` sur `LinkedSubtitlesFields`, donc `editing=true` et l'état `texts` de `CueEditor` survivent au changement d'élément.
- **Scénario** : vidéo A (10 répliques) → « Modifier les textes » → clic sur la vidéo B (15 répliques) → « Appliquer ». Les 10 premières répliques de B reçoivent les textes de A, la corruption se propage à toutes les utilisations de `B.src` et au `.srt` sur disque. Pour i ≥ 10, `texts[i]` vaut `undefined`, d'où une `TypeError`.
- **Correctif** : `<LinkedSubtitlesFields key={element.id} …/>` (et `key={audioTrack.id}`).

#### [Haute] ED-4 — Avec un chevauchement entre scènes, la scène suivante est inatteignable
- **Fichiers** : `src/lib/timeline.ts:178-186` ; `Editor.tsx:306-309,696-700,735-738`.
- **Problème** : `resolveActiveComposition` renvoie la **première** scène qui contient `t`. « Suivant », le clic sur un bloc de scène et la duplication font `clock.set(next.start_time)`, qui tombe dans la scène précédente.
- **Scénario** : scène 1 de 5 s avec 1 s de chevauchement. « Suivant » amène à 4 s et la scène 1 reste active : on est bloqué. « Supprimer la scène » agit sur la mauvaise scène.
- **Correctif** : un état `activeCompositionId` explicite, ou préférer la **dernière** scène qui contient `t`.

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| ED-5 | Désynchronisation audio/vidéo jusqu'à ±250 ms (recalage seulement au-delà de 0,25 s, par saut brutal) | `Editor.tsx:172-191`, `ElementViews.tsx:270-293`, `AudioPlayer.tsx:46-55` | Média audible comme horloge maître, ou seuil d'environ 40 ms avec ajustement de `playbackRate` |
| ED-6 | Un simple clic déplace l'élément ou le clip de quelques px ou ms et crée une entrée d'annulation (`onChange` sous le seuil `CLICK_SLOP_PX`) | `ElementInteraction.tsx:103-152`, `pointerDrag.ts:225-227`, `Timeline.tsx:131-172`, `elements.ts:389-402` | Ignorer tant que `moved` est faux ; renvoyer l'objet inchangé si le patch n'a pas d'effet |
| ED-7 | Drag « collé » si le bouton est relâché hors de la fenêtre (pas de `setPointerCapture`, `pointercancel` ni test de `buttons`) | `ElementInteraction.tsx:161-170`, `pointerDrag.ts:220-233`, `CanvasStage.tsx:184-206`, `Timeline.tsx:111-122` | Capture du pointeur + `pointercancel` + test `ev.buttons === 0` |
| ED-8 | Raccourcis (Suppr, Espace, Ctrl+A, Ctrl+Z) actifs **sous les modales** : Suppr supprime l'élément derrière la fenêtre d'export | `useEditorShortcuts.ts:50-89` | Drapeau `modalOpen` / `aria-modal` |
| ED-9 | Champ « chevauchement » de la timeline : impossible de taper « 0.5 » (input contrôlé, `Number("")=0`) | `Timeline.tsx:341-351` | Utiliser `NumberField` |
| ED-10 | « Lecture » ne fait rien quand la tête est à la fin | `Editor.tsx:172-191,546,684` | `clock.set(0)` si `t >= duration - ε` |
| ED-11 | Pas-à-pas image (←/→) sans effet sur la vidéo en pause (seuil de 0,25 s), donc une coupe sur une image différente de celle affichée | `ElementViews.tsx:290-292` | Seuil de ½ image en pause |
| ED-12 | Nouveau / Ouvrir / Récents inopérants depuis les onglets Audio, Image et Vidéo (actions enregistrées seulement par Home et l'Editor) | `Home.tsx:81-85`, `menuBridge.tsx:99,106`, `AppMenuBar.tsx:52-68` | Enregistrer ces actions au niveau d'`App` |
| ED-13 | « Nouveau projet » depuis un éditeur **ferme** l'onglet courant | `Editor.tsx:570`, `tabs.ts:88-95` | Activer Home sans fermer l'onglet |
| ED-14 | Un média encore référencé dans l'historique d'annulation peut être supprimé de la médiathèque (Ctrl+Z restaure alors un élément cassé) | `LibraryPanel.tsx:384-391,495-507` | Tester aussi `past`/`future` |
| ED-15 | Après un curseur, une case à cocher ou une liste, Ctrl+Z, Espace et Suppr ne répondent plus (filtre sur tout `input`/`select`) | `useEditorShortcuts.ts:50-51` | Ne bloquer que les champs texte |
| ED-16 | Canvas : tout le sous-arbre est re-rendu à chaque image ; `geometries.filter(...)` alloue O(n²) par image | `CanvasStage.tsx:116-122,293-309,410-487`, `ShapeView.tsx:27`, `ElementInteraction.tsx:59` | `memo` + callbacks stables, `siblings` calculés au début du drag |
| ED-17 | Chaque `pointermove` d'un drag re-rend tout l'Editor (médiathèque, timeline, propriétés), relance l'autosave et `expandLinkedSubtitles` | `Editor.tsx:196-198,566,627-768`, `ElementInteraction.tsx:151` | Une mutation par rAF au plus, `memo` sur les panneaux |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| ED-18 | Même projet ouvrable dans deux onglets si les chemins diffèrent textuellement : deux autosaves concurrents | `lib/tabs.ts:68` |
| ED-19 | Fermeture de fenêtre refusée sans explication si l'échec d'écriture concerne un onglet en arrière-plan | `lib/closeGuard.ts:19`, `Editor.tsx:619-625` |
| ED-20 | Un média glissé sur l'éditeur ouvre un outil au lieu d'être importé ; un dossier `.lvproj` déposé est refusé | `App.tsx:40-58,95-111` |
| ED-21 | Raccourcir une scène rend des éléments invisibles sans avertissement | `lib/timeline.ts:63-69`, `Timeline.tsx:380-382` |
| ED-22 | La fusion d'historique s'applique aussi aux actions discrètes (deux ajouts annulés d'un coup) | `Editor.tsx:383`, `lib/history.ts:22-24` |
| ED-23 | i18n : « W »/« H » en dur ; B/I/U/S, flèches d'alignement et « S » de contour sans `title`/`aria-label` ; « fps » et « WAV 32-bit float » non traduits | `properties/PositionFields.tsx:13-30`, `TextProperties.tsx:77-318`, `options.tsx:108,112`, `ShapeProperties.tsx:74`, `TopBar.tsx:139`, `editor/ExportModal.tsx:251` |
| ED-24 | Libellés d'historique (`JSON.stringify` par élément) recalculés à chaque mutation | `Editor.tsx:207-211`, `historyLabels.ts:19,154-157` |
| ED-25 | `expandLinkedSubtitles` reconstruit tous les éléments de sous-titres à chaque mutation | `Editor.tsx:566`, `lib/subs/linked.ts:60-111` |
| ED-26 | `AudioPlayer` : chaque piste se re-rend et exécute 2 effets à chaque image | `AudioPlayer.tsx:20,46-55` |
| ED-27 | Auto-fit du texte : 13 recalculs de mise en page forcés par mesure, relancés à chaque image pendant un redimensionnement | `ElementViews.tsx:47-98` |
| ED-28 | `Editor.tsx` monolithique (771 lignes, environ 40 gestionnaires) ; les onglets masqués gardent leurs `<video preload="auto">` | `Editor.tsx`, `App.tsx:20-24` |

---

### 5.7 Frontend vues Vidéo, Audio et sous-titres

Garde `loadId` contre les chargements concurrents, gestes regroupés en un seul pas d'annulation, saut des coupes à chaque image, ordre DSP de l'aperçu identique au moteur Rust. Les arguments `invoke` et les noms d'événements correspondent au backend, et les 109 clés i18n utilisées existent dans les deux langues.

#### [Critique] OU-1 — Un rechargement forcé après une erreur de lecture efface toutes les modifications et l'historique
- **Fichiers** : `src/components/videotool/VideoTool.tsx:594-611` (appel `loadVideo(videoPath, true)` l. 609), `:223-275` (signature `(filePath, force = false, keep?)`, puis `reset(keep)` l. 257) ; `hooks/useHistory.ts:132` (`reset(val = defaultEditable)`).
- **Problème** : `true` est passé comme `force`, et `keep` reste `undefined`. `reset()` remet donc `defaultEditable` et vide `past` et `future`. `hasEdits` repasse à `false`, si bien que la fermeture de l'onglet ne demande plus confirmation. L'écran de chargement démonte aussi une `ExportModal` ou une `GenerateSubtitlesDialog` ouverte.
- **Scénario** : 20 minutes de montage, puis une erreur de lecture (image corrompue, ou fichier d'aperçu supprimé par un autre onglet, voir OU-2) : la vidéo revient vierge, sans avertissement.
- **Correctif** : pour un rechargement de la même source, passer `keep = editable` sans toucher à l'historique, ou ne remplacer que `videoUrl`. Réserver `reset()` à l'ouverture d'un nouveau fichier.

#### [Haute] OU-2 — Aperçu, annulation et progression de la vue Vidéo globaux : un onglet casse l'autre
- **Fichiers** : `src-tauri/src/commands/video_tool.rs:306-319,379-383,617-624` ; `src/components/videotool/api.ts:142-143,183-186,244,261-264` ; appelants `VideoTool.tsx:327-331`, `ExportModal.tsx:546-548`, `SequencesModal.tsx:163-167`.
- **Scénario** :
  1. L'onglet B ouvre une vidéo : le fichier d'aperçu de A est supprimé, A tombe en erreur, ce qui déclenche OU-1.
  2. B ouvre une vidéo pendant une fusion dans A : la fusion de A est annulée.
  3. Fermer la fenêtre Séquences dans B annule l'export « maintenant » de A (`cancelFfmpeg` annule tous les `dialogJobs`).
  4. Deux exports en parallèle : les barres de progression sautent de l'un à l'autre.
- **Correctif** : voir §4.2, un identifiant d'opération par onglet ou par requête, et une progression filtrée par job.

#### [Haute] OU-3 — Fenêtre d'export bloquée après « Exporter à nouveau » puis annulation du dialogue
- **Fichier** : `videotool/components/ExportModal.tsx:156,166-168,195-217,543-556`.
- **Problème** : `setDone(false)` alors que `progress` vaut encore 100, donc `exporting` repasse à `true`. L'annulation du dialogue sort de la fonction sans remettre `progress` à `null`.
- **Scénario** : la fenêtre reste à 100 %, tous les boutons de sortie sont désactivés, et seule la fermeture de l'onglet en sort, avec perte du travail. Aucun test ne couvre ce chemin.
- **Correctif** : `setProgress(null)` au début de `handleExport`, ou un booléen `running` géré dans un `finally`.

#### [Haute] OU-4 — La touche Suppr de la timeline Vidéo agit depuis les onglets masqués et derrière les modales
- **Fichier** : `videotool/components/Timeline.tsx:228-245`.
- **Scénario** : une coupe est sélectionnée dans l'onglet Vidéo. Suppr dans l'éditeur de projet supprime **aussi** cette coupe, sans retour visuel.
- **Correctif** : conditionner par `useTabActive()` et l'absence de modale, ou centraliser la touche dans le gestionnaire clavier de `VideoTool`, qui gère déjà ces deux cas.

#### [Haute] OU-5 — Le sous-titre généré n'est jamais associé si la traduction enchaînée échoue
- **Fichier** : `subtitles/GenerateSubtitlesDialog.tsx:215-239,553`.
- **Scénario** : transcription Whisper de 10 minutes avec traduction et une clé DeepL expirée. La fenêtre affiche « associé à la vidéo », mais rien n'est enregistré et la transcription est perdue.
- **Correctif** : appeler `onAssociate(out.srt_content, …)` juste après `setResult(out)`, puis à nouveau avec la traduction si elle réussit.

#### [Haute] OU-6 — La file d'export n'a aucune interface : `QueueManager` n'est jamais monté
- **Fichiers** : `videotool/components/QueueManager.tsx:16` (aucun import hors tests, vérifié) ; `ExportModal.tsx:228-241` ; `VideoTool.tsx:579`.
- **Scénario** : trois exports mis en file, le second échoue, et l'utilisateur ne le sait jamais. « Exporter maintenant » attend derrière la file (le worker est unique) en affichant 0 %, sans moyen d'annuler. Les travaux terminés ne sont jamais purgés, et chaque pourcent de progression réémet la liste complète.
- **Correctif** : monter `QueueManager` dans `App` ou `VideoTool`, et afficher « En attente (n devant) » dans `ExportModal`.

#### [Haute] OU-7 — L'aperçu audio décode tout le fichier en JS et en garde jusqu'à trois copies PCM complètes
- **Fichiers** : `src/lib/audiotool/commands.ts:42-46` ; `previewEngine.ts:140-144,192-220,346-378` ; `AudioTool.tsx:167-170`.
- **Scénario** : podcast de 2 h, soit 2,8 Go par copie : décodage en échec ou plantage de la WebView. Avant cela, l'écran reste sur « Chargement » alors que Rust a fini.
- **Correctif** : afficher l'éditeur dès le retour de `audioLoad`. Lire via `<audio>` ou `MediaElementSource` en flux avec saut des coupes, ou faire produire par Rust un aperçu décimé. Remplacer la recopie de `setKept` par des `source.start(when, offset, duration)` successifs.

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| OU-8 | Aperçu audio : ajouter ou retirer une coupe avant la tête la fait sauter de la longueur de la coupe (`startOffset` en temps virtuel) | `previewEngine.ts:192-224`, `AudioTool.tsx:198-200`, `CutTimeline.tsx:89` | Conversion virtuel → réel → virtuel avant de remplacer `kept` |
| OU-9 | `AudioContext` recréé après `dispose()` si l'onglet se ferme pendant le chargement (fuite) | `AudioTool.tsx:160-166,191-193,230`, `previewEngine.ts:114-117,140-142,417-424` | Drapeau `disposed` + test de `cancelled` avant `decode` |
| OU-10 | Spectrum : chaque redimensionnement pendant la lecture démarre une boucle rAF de plus, jamais arrêtée, même en pause | `audiotool/Spectrum.tsx:402-457` | Séparer `paint()` de `loop()` |
| OU-11 | Export audio : annulation et progression partagées entre onglets (`AudioExportControl` unique) | `audio_tool.rs:28-30,259-277`, `AudioTool.tsx:352-358,613` | Identifiant par export |
| OU-12 | La vue Audio n'a **aucune** garde de fermeture : coupes, fondus et historique perdus sans confirmation | `App.tsx:176-180`, `AudioTool.tsx:423-446` | `registerCloseGuard`/`registerBeforeExit` comme `VideoTool.tsx:546-555` |
| OU-13 | Après une fusion de séquences, l'onglet se ferme sans confirmation et le résultat temporaire (`lev_merge_*.mp4`) est perdu | `VideoTool.tsx:218-221,282-305` | Drapeau `dirty` séparé de l'historique |
| OU-14 | Plus de 200 séquences : aucune vignette (erreur avalée) ; vignettes en série et non annulables | `SequencesModal.tsx:137-167`, `video_tool.rs:477-480` | Lots de 200, commande annulable |
| OU-15 | Erreurs du moteur vidéo affichées brutes en anglais (« Stabilization is not available… ») | `ExportModal.tsx:213-257`, `api.ts:250`, `video_tool.rs:715`, `queue.rs` | Erreurs codées traduisibles, comme `audio-dsp` |
| OU-16 | Normalisation de l'aperçu : rendu hors ligne complet après chaque réglage, sans annulation, avec des rendus qui s'empilent | `previewEngine.ts:226-234,346-414` | Ne lancer qu'après la fin du précédent, pic calculé sur un buffer décimé |
| OU-17 | FilmStrip : décodage complet par ffmpeg à chaque tranche de 80 px de redimensionnement, processus jamais annulés | `FilmStrip.tsx:398-415`, `video_tool.rs:428-466` | Recherche par vignette, cache de 200 vignettes, annulation |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| OU-18 | Entrée `after_export` orpheline si `queue_add` est refusé : un export ultérieur est ajouté à d'anciens projets | `ExportModal.tsx:219-247`, `video_tool.rs:57,750-766` |
| OU-19 | Le changement d'URL de flux remet `playbackRate` à 1× | `VideoTool.tsx:596-603`, `VideoPlayer.tsx:44-46` |
| OU-20 | « Entrée » applique le recadrage depuis n'importe où, y compris un champ de saisie ou un autre onglet | `videotool/components/CropOverlay.tsx:50-57` |
| OU-21 | Champ de temps d'une coupe audio : une saisie bornée sans effet laisse le texte invalide affiché | `CutTimeline.tsx:343-352,400-416` |
| OU-22 | Forme d'onde fixe à 900 points, sans zoom (environ 9 s par pixel sur 3 h) | `AudioTool.tsx:60`, `CutTimeline.tsx:116,150-154` |
| OU-23 | La fenêtre de sous-titres (portail vers `body`) reste visible quand on change d'onglet | `GenerateSubtitlesDialog.tsx:385,740` |
| OU-24 | Toast « ajouté aux projets » affiché seulement sur l'onglet Vidéo actif, éventuellement le mauvais | `VideoTool.tsx:632-641` |
| OU-25 | i18n : « H: »/« V: », `<kbd>Enter</kbd>`, « #1 » répété pour chaque génération, noms de familles de polices génériques, `title="M:SS.s"` | `ExportModal.tsx:308`, `CropOverlay.tsx:189`, `AudioTool.tsx:631`, `VideoTool.tsx:616`, `SubtitlesPanel.tsx:49-51`, `CutTimeline.tsx:422` |
| OU-26 | CutTimeline se re-rend entièrement 60 fois par seconde (`getComputedStyle` deux fois par image) | `CutTimeline.tsx:88-140` |
| OU-27 | VideoTool se re-rend entièrement à chaque `timeupdate` ; SubtitleOverlay fait un `setState` à chaque image | `VideoTool.tsx:405-411`, `Timeline.tsx:247,279,362-378`, `SubtitleOverlay.tsx:43-71` |

---

### 5.8 Frontend vue Image et `src/suite`

Backend source de vérité de l'historique, URL `lcimg` immuables, aperçus fusionnés et calculés par le même code que le rendu final. Les 26 `invoke` correspondent aux commandes Rust.

#### [Haute] IT-1 — L'état « modifié » repose sur `historyIndex` : modifications perdues sans confirmation
- **Fichiers** : `src/components/imagetool/ImageTool.tsx:228` (`isDirty = historyIndex !== savedIndex`) ; `hooks/useImageEditor.ts:44-51,276,420` ; `src-tauri/src/imgz/mod.rs:92-100` (`enforce_budget`).
- **Problème** : `savedIndex` est une **position**. Elle ne bouge pas quand une étape est remplacée (reprise d'un curseur), ni quand le budget est atteint (environ 14 étapes à 24 Mpx : l'étape 1 est supprimée et l'index reste à `len-1`). Le même défaut fait qu'une rotation libre peut écraser une rotation de ±90° (`RotationControls.tsx:39-46,70-84`).
- **Scénario** : luminosité à 20, export, reprise du curseur à 40, puis Ctrl+W : l'onglet se ferme **sans demander**.
- **Correctif** : identifier l'état par l'`epoch` (déjà dans l'URL `lcimg`) ou par un compteur `revision`, et non par sa position.

#### [Haute] IT-2 — « Quitter » (menu et Ctrl+Q) appelle `exit(0)` : aucune protection
- **Fichier** : `src/suite/useSuiteMenu.ts:73-78` (vérifié : `action: () => void exit(0)`).
- **Problème** : ce chemin ne passe ni par `onCloseRequested`, ni par `runBeforeExit`, ni par `confirmQuitWithBusyWork`. Les gardes Image et Vidéo et l'autosave en attente sont ignorés, et les exports sont tués.
- **Correctif** : `getCurrentWindow().close()`, qui déclenche le même chemin que la croix de fenêtre (voir §4.3).

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| IT-3 | La mise à jour est **installée** avant de demander confirmation ; si l'utilisateur refuse le redémarrage, un message faux s'affiche (« n'a pas pu être enregistré ») et il n'y a plus de bouton pour redémarrer | `suite/UpdaterProvider.tsx:159-185`, `Root.tsx:29` | `beforeRestart()` avant, ou `download()` puis `install()` après confirmation |
| IT-4 | `t("cvs.anchor")` pointe sur un **objet** : le message d'erreur i18next s'affiche à la place de « Ancrage » (vérifié) | `imagetool/CanvasResizeDialog.tsx:177` | `t("cvs.anchor-label")` |
| IT-5 | Menu natif entièrement reconstruit (environ 60 objets, autant d'appels IPC) à chaque changement de `canUndo`/`canRedo`, sans `close()` de l'ancien | `suite/useSuiteMenu.ts:189-197`, `suite/menu.ts:253-264`, `AppMenuBar.tsx:113-142` | `item.setEnabled()` ; ne reconstruire que sur changement de langue, de thème ou de récents |
| IT-6 | Rotation libre : une fois le budget atteint, un ±90° suivi d'un nouvel angle écrase le ±90° (cas lié à IT-1) | `RotationControls.tsx:39-46,70-84` | `expectedIndex = position` renvoyée par le backend |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| IT-7 | Préréglages et duotone : curseurs de la section précédente non remis à zéro (`endSession()` avant `commit`), d'où un effet cumulé | `FiltersPanel.tsx:430-433`, `hooks/useCommitSession.ts:373-379` |
| IT-8 | Zoom molette en butée : l'ancre reste en mémoire et fait sauter le défilement plus tard | `imagetool/Canvas.tsx:194-225` |
| IT-9 | Calque de recadrage non redessiné quand le zoom ou le DPR change (poignées étirées, zone cliquable trompeuse) | `imagetool/CropOverlay.tsx:82-155` |
| IT-10 | Champ de rotation : impossible de taper un angle négatif | `RotationControls.tsx:135-145` |
| IT-11 | Vérification de mise à jour pendant un téléchargement : « Mettre à jour » réapparaît, risque de double `downloadAndInstall` | `suite/UpdaterProvider.tsx:110-146` |
| IT-12 | `confirmDiscard` répond « oui » si la boîte de dialogue échoue (`catch { return true }`) | `ImageTool.tsx:230-236` |
| IT-13 | Plusieurs onglets Image modifiés : plusieurs boîtes « Quitter ? » ouvertes en même temps (`Promise.all`) | `lib/lifecycle.ts:24-35` |
| IT-14 | Aperçu faux sur les images semi-transparentes (l'original reste visible en dessous) | `imagetool/Canvas.tsx:513-543` |
| IT-15 | Panneaux Redimensionner et Taille du canevas fermés même quand l'opération échoue | `ImageTool.tsx:715-730` |
| IT-16 | Clé `imageTool.update.dismiss` absente des deux langues | `ImageTool.tsx:503` |
| IT-17 | Erreurs Rust brutes en anglais dans les toasts (`String(e)`), libellé par défaut « Image » non traduit | `useImageEditor.ts:172`, `ImageTool.tsx:808,830`, `lib/errors.ts:84-91` |
| IT-18 | Bundle principal de 714 Ko : `ImageTool` et `AudioTool` ne sont pas chargés à la demande (seul `VideoTool` l'est) | `vite.config.ts`, `App.tsx` |
| IT-19 | Masque d'inpaint en pleine résolution (96 Mo à 24 Mpx) parcouru en entier sur le thread principal | `imagetool/Canvas.tsx:573-577`, `ImageTool.tsx:68-95` |
| IT-20 | Ancien nom « LightCutImgz » écrit en dur sur l'écran d'accueil de la vue Image | `imagetool/Canvas.tsx:421-423` |

---

### 5.9 Build, CI, distribution

#### [Haute] CI-1 — Actions GitHub non épinglées par SHA dans le job qui reçoit la clé de signature de l'updater
- **Fichiers** : `.github/workflows/release.yml:61-91` (aussi `ci.yml:19-39`, `site.yml:167-189`).
- **Problème** : le job `build` (`contents: write`) passe `TAURI_SIGNING_PRIVATE_KEY` à `tauri-apps/tauri-action@v0` et exécute `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`, `actions/checkout@v4` et `actions/setup-node@v4`, tous référencés par des étiquettes mobiles. Aucun Dependabot ne surveille les actions.
- **Scénario** : une étiquette compromise (cas tj-actions/changed-files en 2025) permet de lire la clé minisign, puis de publier un `latest.json` signé, qui atteint tous les utilisateurs par la mise à jour.
- **Correctif** : épingler chaque `uses:` sur un SHA complet, activer Dependabot `github-actions`, isoler la signature dans un job minimal sans cache.

#### Moyenne
| ID | Constat | Fichier | Correctif |
|---|---|---|---|
| CI-2 | **`install.sh` ne vérifie aucune somme SHA-256** (vérifié : aucun `sha256` dans le script), alors que le site et `release.yml:103` affirment le contraire. Le paquet est installé avec `sudo` | `install.sh:91-115`, `site/src/data/apps.ts:40-41,71-75` | Télécharger `SHA256SUMS`, `sha256sum -c`, ou vérifier la signature minisign `.sig` |
| CI-3 | Application macOS non signée ni notarisée ; le cask demande `xattr -dr com.apple.quarantine` | `homebrew-tap/Casks/light-editor-vidz.rb`, `release.yml:81-91` | Developer ID + notarisation (`APPLE_*`) |
| CI-4 | Release publiée **avant** les binaires (`gh release create` sans `--draft`) ; un build en échec laisse une release partielle marquée « latest », sans mise à jour Mac et sans alerte | `release.yml:41,53-55` | `--draft`, puis publication dans un job final qui vérifie toutes les cibles |
| CI-5 | CI incomplète : ni clippy, ni `cargo fmt --check`, ni `prettier --check`, ni audit ; tests Rust seulement sous Linux ; un tag `v*` publie même si la CI est rouge | `ci.yml:13-53`, `release.yml:5-7` | Ajouter ces étapes, un job `macos-latest`, et `needs:` sur la CI |
| CI-6 | **Aucun `[profile.release]`** (vérifié : seul `profile.dev.package."*"` existe) : ni LTO, ni `codegen-units = 1`, ni `strip`. Le binaire de debug fait 814 Mo | `Cargo.toml` | `lto = "thin"`, `codegen-units = 1`, `strip = "symbols"` |

#### Basse
| ID | Constat | Fichier |
|---|---|---|
| CI-7 | `install.sh` exécuté via `curl \| bash` sans fonction `main()` ni `set -u` (un flux tronqué exécute un script partiel) | `install.sh:11,140-158` |
| CI-8 | `install.sh` : l'AppImage est écrite directement à sa place (cassée si le téléchargement est interrompu, `ETXTBSY` si l'application tourne) ; pas de `trap` de nettoyage ; JSON de l'API GitHub lu avec `grep` | `install.sh:94-115` |
| CI-9 | Deux versions de `keyring` (v3 avec libdbus et v4 avec zbus) : deux piles Secret Service | `src-tauri/Cargo.toml:47-48,55` |
| CI-10 | `ort` épinglé sur une préversion (`=2.0.0-rc.15`), binaire onnxruntime téléchargé au build | `src-tauri/Cargo.toml:43` |
| CI-11 | ffmpeg BtbN épinglé sur une « autobuild » datée, dont la conservation est limitée (à confirmer), d'où un 404 futur pour la CI et la release | `scripts/ffmpeg-sources.json:110,117` |
| CI-12 | `tsconfig.json` ajoute `"types": ["node"]` au code navigateur (`process.env` compile, puis plante à l'exécution) | `tsconfig.json:16` |
| CI-13 | Cask sans version minimale de macOS (`tauri.conf.json` exige 11) | `homebrew-tap/Casks/light-editor-vidz.rb` |
| CI-14 | `install.sh` : branche deb sans nettoyage du dossier temporaire si `apt-get` échoue | `install.sh:94-99` |
| CI-15 | Suite vitest : jsdom recréé 123 fois (48 % du temps) ; 2 tests dépassent 5 s sous charge | `vitest.config.ts` |

---

## 6. Plan d'action recommandé

### P0 — Perte de données (correctifs courts, quelques lignes chacun)
1. **C1 / AV-1 / AV-2** : refuser une sortie égale à l'entrée dans `prepare` (`canonicalize`), écrire l'export vidéo dans un `.part` puis `rename`, et retirer le `remove_file(output_path)` de `run_job`.
2. **C2 / OU-1** : `loadVideo(videoPath, true, editable)` au lieu de `loadVideo(videoPath, true)`, ou un rechargement qui ne remplace que l'URL.
3. **C3 / ED-1** : supprimer l'effet `preloadMedia` de `Editor.tsx`, et ajouter une limite de taille à `read_media_file`.
4. **IT-2** : remplacer `exit(0)` par `getCurrentWindow().close()`.
5. **ED-3** : `key={element.id}` sur `LinkedSubtitlesFields`.
6. **OU-3** : `setProgress(null)` au début de `handleExport`.
7. **OU-5** : `onAssociate` avant la traduction.
8. **IM-1** : `Limits` explicites au décodage d'image.

### P1 — Intégrité, rendu, sécurité
- §4.3 : chemin de sortie unifié (ED-2, OU-12, OU-13, IT-3, TC-4, IT-13).
- IT-1 / IT-6 : identifier l'état d'une image par son epoch.
- §4.2 : identifiant d'opération pour l'aperçu, l'annulation et la progression (OU-2, OU-11, SZ-11, OU-4).
- Parité de rendu (§4.1) : SC-1 à SC-5, SC-8 à SC-12, avec des tests de rendu de référence.
- IM-2 / IM-3 / IM-5 : EXIF, `reset_tool`, course undo/commit.
- ED-4 : scène active explicite.
- OU-6 : monter `QueueManager`.
- CI-1, CI-2, CI-4 : épinglage des actions, vérification SHA dans `install.sh`, release en brouillon.
- TC-2, TC-3, IM-4 : retirer `store:default`, généraliser `Approved`.

### P2 — Performance
- TC-1 / SC-6 / SC-7 / SC-13 / SC-14 : rendu par blocs contigus, sonde avant l'échelle, budgets mémoire. C'est probablement le plus gros gain sur les temps d'export.
- AV-3, AV-4, OU-7 : mémoire audio et fusion de séquences.
- AV-9 à AV-12, OU-17 : passes ffmpeg superflues, recherche rapide (`-ss`), vignettes.
- IM-12 à IM-15 : cache `lcimg` et aperçu, inpaint, copies RGBA.
- ED-16 / ED-17 / OU-26 / OU-27 : mémoïsation et limitation des re-rendus à une fois par image.
- TC-6 : protocole `lvmedia` asynchrone.
- CI-6 : profil `release`.

### P3 — UX, i18n, dette
Les autres constats moyens et bas, notamment ED-5 à ED-15, OU-8 à OU-16, SZ-1 à SZ-6, IT-4, CI-5.

---

## 7. Points forts du code

- **Tests abondants** (2 507 tests frontend et 1 308 tests Rust, tous verts), dont de vrais tests ffmpeg et une **fixture golden partagée** Rust/TS pour la parité des animations.
- **Aucun avertissement** du compilateur TypeScript ni de clippy, et zéro CVE dans les dépendances.
- **Architecture réfléchie** : horloge de lecture hors de React (`useSyncExternalStore`), historique immuable avec partage structurel, backend source de vérité pour la vue Image, URL `lcimg` versionnées par epoch.
- **Sécurité globalement bonne** :
  - CSP sans `unsafe-inline`/`unsafe-eval` pour les scripts ;
  - scope `asset:` vide au départ ;
  - modèle `Approved` pour les vues Audio, Vidéo et sous-titres ;
  - confinement des médias au dossier projet (canonicalisation, liens symboliques) ;
  - ffmpeg sans shell, avec un double échappement correct et le préfixe `file:` ;
  - clés API dans le trousseau système, transmises dans les en-têtes, jamais dans les URL ni les erreurs ;
  - modèles téléchargés vérifiés par SHA-256 avant d'être installés.
- **Robustesse** :
  - écriture `.part` + `rename` pour l'audio et l'export de projet ;
  - stderr de ffmpeg lu en continu ;
  - `Drop` qui tue ffmpeg ;
  - panics des workers convertis en erreurs ;
  - NaN et infinis refusés dans le DSP ;
  - découpage du texte des sous-titres sûr pour l'UTF-8.
- **DSP correct** : biquads RBJ en f64, Butterworth en cascade, dither TPDF, fondus exacts.
- **i18n complète et symétrique** (924 clés en/fr), erreurs Rust portant des codes traduisibles.
