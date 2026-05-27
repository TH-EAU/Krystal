# Contexte — Krystal (obsidian-context-plugin)

Plugin Obsidian en TypeScript qui :
1. **Génère** un fichier `CONTEXT.md` depuis un canvas Obsidian (+ `KRYSTAL_API.md`)
2. **Importe** les modifications faites par l'IA dans `CONTEXT.md` vers les notes du vault
3. **Synchronise** le canvas Obsidian depuis le diagramme Mermaid de `CONTEXT.md`

---

## Stack

- **Langage :** TypeScript
- **Build :** esbuild via `esbuild.config.mjs`
- **Dev :** `node esbuild.config.mjs` (watch mode)
- **Runtime :** Obsidian Desktop (Electron)
- **Entry point :** `src/main.ts` → compilé en `main.js`

---

## Structure

```
src/
  main.ts             — plugin principal, settings, commandes, orchestration
  context-builder.ts  — génération CONTEXT.md depuis le canvas (+ parseFrontmatter exporté)
  context-importer.ts — import des modifications IA → notes vault
  canvas-updater.ts   — sync canvas depuis le diagramme Mermaid du CONTEXT.md
  mermaid-parser.ts   — parse un bloc Mermaid flowchart → graphe structuré
  note-creator.ts     — modales + commandes de création de notes par kind
  settings.ts         — onglet settings + DEFAULT_SETTINGS
  types.ts            — types partagés (CanvasData, kinds, NoteFrontmatter…)
  vscode-menu.ts      — menu clic-droit "Ouvrir dans VS Code"
  krystal-api.ts      — contenu statique de KRYSTAL_API.md (string constant)
manifest.json
package.json
tsconfig.json
esbuild.config.mjs
```

---

## Fichiers source

### src/main.ts
Point d'entrée du plugin. Enregistre l'icône SVG, le bouton ribbon, les commandes et l'onglet settings.

Commandes exposées :
- `generate-context` → `ContextBuilder.generate()`
- `import-context` → `ContextImporter.importFromContext()`
- `sync-canvas-from-mermaid` → `CanvasUpdater.syncFromMermaid()`
- `create-note-<kind>` × 13 kinds → `NoteCreator`

Dépendances internes : tous les modules `src/`.

### src/context-builder.ts
Cœur du plugin. Lit le canvas actif (ou celui configuré dans les settings), construit le `CONTEXT.md` et ses éventuels sous-contextes.

Responsabilités :
- Parse le canvas JSON (`CanvasData`) et construit l'arbre de groupes (`GroupTree`)
- Génère le diagramme Mermaid (flowchart TD) avec subgraphs, classDefs et formes par kind
- Agrège les notes `.md` et produit les sections `### NomNote <!-- vault:... -->`
- Gère les blocs `<!-- kind-block -->` (auto-générés depuis le frontmatter)
- Gère la récursion sur les nœuds canvas référencés (sous-contextes)
- Écrit aussi `KRYSTAL_API.md` à côté du `CONTEXT.md`
- Export : `class ContextBuilder`, `function parseFrontmatter`

### src/context-importer.ts
Lit le `CONTEXT.md` généré (ou modifié par l'IA), en extrait les sections par ancre `<!-- vault:... -->`, et reporte la prose dans les notes vault correspondantes.

Logique :
- Parser de sections (`parseSections`) : découpe le CONTEXT.md en `ParsedSection[]`
- `extractProse` : retire Source/Relations/kind-blocks, normalise les blancs
- `mergeNoteContent` : préserve le frontmatter et le titre de la note, restaure les blocs `:::lock`
- Notes inexistantes → créées dans le vault
- Notes `frozen:true` → ignorées
- Export : `class ContextImporter`

### src/canvas-updater.ts
Lit le bloc Mermaid du `CONTEXT.md` et applique un diff sur le canvas ouvert :
- Nouveaux nœuds → ajoutés avec auto-layout BFS
- Labels modifiés → mis à jour
- Nouvelles arêtes → ajoutées
- Export : `class CanvasUpdater`

### src/mermaid-parser.ts
Parser minimaliste pour notre format Mermaid contrôlé (flowchart TD).
- Reconnaît nodes, edges, subgraphs, gateway nodes (`:::gw`), classDefs
- Export : `parseMermaid(block)`, `extractMermaidBlock(markdown)`, types `ParsedMermaid*`

### src/note-creator.ts
Modales et commandes pour créer des notes avec le bon template selon le `kind`.
- `CreateNoteModal` : demande le nom et le dossier
- `SetKindModal` : permet de changer le kind d'une note existante (menu clic-droit)
- Templates pour les 13 kinds (frontmatter pré-rempli + structure Markdown)
- Export : `class NoteCreator`, `KIND_LABELS`

### src/settings.ts
Onglet settings Obsidian. Permet de configurer le canvas cible, le chemin projet et le fichier de sortie.
- Export : `class ContextGeneratorSettingTab`, `DEFAULT_SETTINGS`

### src/types.ts
Types partagés entre tous les modules.

Concepts clés :
- `CanvasData / CanvasNode / CanvasEdge` — structure JSON du canvas Obsidian
- `CodeKind` — `component | interface | type | enum | config | media | file`
- `PlanKind` — `epic | task | milestone | decision | question | spec`
- `AnyKind = CodeKind | PlanKind`
- `NoteFrontmatter` — `{ file?, kind?, frozen? }`
- `kindCategory(k)` → `"plan" | "code"`
- `ContextGeneratorSettings` — `{ projectPath, canvasFile, outputFile }`

### src/vscode-menu.ts
Ajoute l'item "Ouvrir dans VS Code" au menu clic-droit des notes `.md`.
Lit le champ `file` du frontmatter et ouvre `vscode://file/<absPath>`.

### src/krystal-api.ts
Contient `KRYSTAL_API_CONTENT` — la chaîne Markdown qui sera écrite dans `KRYSTAL_API.md`.
Ce fichier explique à l'IA comment lire et modifier `CONTEXT.md`.

---

## Format des notes Obsidian

```markdown
---
kind: component        # AnyKind
file: src/mon-module/mon-fichier.ts   # chemin relatif depuis projectPath
frozen: true           # optionnel — interdit les modifications IA
# champs spécifiques au kind (fields, params, values, definition…)
---

## NomDuComposant

Description libre...
```

---

## Settings

| Clé | Défaut | Description |
|-----|--------|-------------|
| `canvasFile` | `""` | Chemin du `.canvas` dans le vault |
| `projectPath` | `"../"` | Chemin relatif vault → racine projet |
| `outputFile` | `"CONTEXT.md"` | Nom du fichier généré |

---

## Système de kinds

**CodeKind** (territoire IA, bleu dans le canvas) :
`component`, `interface`, `type`, `enum`, `config`, `media`, `file`

**PlanKind** (territoire utilisateur, violet dans le canvas) :
`epic`, `task`, `milestone`, `decision`, `question`, `spec`

Les notes `PlanKind` sont incluses dans CONTEXT.md avec le marqueur `plan:true` et ne doivent pas être modifiées par l'IA sauf instruction explicite.

---

## Workflow complet

```
1. Utilisateur ouvre un canvas dans Obsidian
2. Clic sur le bouton ribbon (ou commande "Générer le contexte")
   → ContextBuilder.generate()
   → Écrit CONTEXT.md + KRYSTAL_API.md dans projectPath

3. L'IA lit CONTEXT.md + KRYSTAL_API.md
   → Modifie la prose des sections, le diagramme Mermaid, ou crée de nouvelles sections

4. Utilisateur lance "Synchroniser depuis CONTEXT.md"
   → ContextImporter.importFromContext()
   → Met à jour les notes vault existantes / crée les nouvelles

5. Utilisateur lance "Synchroniser canvas depuis Mermaid"
   → CanvasUpdater.syncFromMermaid()
   → Applique les nouveaux nœuds/arêtes Mermaid dans le canvas visuel
```

---

## Ce qui fonctionne

- Génération du `CONTEXT.md` (multi-niveaux, groupes, sous-contextes) ✅
- Génération de `KRYSTAL_API.md` ✅
- Diagramme Mermaid avec subgraphs, classDefs, formes par kind ✅
- Import IA → vault (merge prose, préservation lock blocks, création de notes) ✅
- Sync canvas depuis Mermaid (add nodes/edges, auto-layout BFS) ✅
- Menu clic-droit "Ouvrir dans VS Code" ✅
- Commandes "Créer note" pour les 13 kinds ✅
- Menu "Définir le kind" sur une note existante ✅
- Bouton ribbon avec icône SVG ✅

---

## TODO (idées futures)

- Système de diff : montrer à l'agent ce qui a changé dans le contexte depuis la dernière génération
- Système de templates importables (bonnes pratiques prédéfinies par domaine)
- Mémoire des erreurs IA passées, accessible dans CONTEXT.md pour éviter les boucles
