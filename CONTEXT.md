# Contexte — obsidian-context-plugin

Plugin Obsidian en TypeScript qui génère un fichier `CONTEXT.md` depuis un canvas Obsidian,
pour donner du contexte à Claude Code en début de session.

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
  canvas-highlight.ts — highlight des edges via modification du JSON .canvas (stable, API officielle)
  canvas-animator.ts  — animation CSS pointillés via MutationObserver (optionnel, fragile)
manifest.json
package.json
tsconfig.json
esbuild.config.mjs
```

---

## Fichiers source

### src/main.ts
Point d'entrée du plugin. Responsabilités :
- Enregistrement de l'icône SVG (`addIcon`)
- Bouton ribbon
- Menu clic-droit "Ouvrir dans VS Code" sur les notes `.md` (via `file-menu`)
- Détection du canvas actif (`active-leaf-change`) et attachement du `CanvasAnimator`
- Génération du `CONTEXT.md` : lit le `.canvas`, agrège les notes liées, écrit le fichier via `fs`
- Settings page (canvas cible, chemin projet, nom du fichier de sortie)

Dépendances internes : `canvas-highlight.ts`, `canvas-animator.ts`

### src/canvas-highlight.ts
Highlight des edges connectées à un nœud cliqué.
Stratégie : lit le `.canvas` (JSON), modifie le champ `color` des edges concernées, réécrit le fichier.
Obsidian recharge le canvas automatiquement.
Exports : `highlightConnectedEdges(vault, canvasFile, selectedNodeFile)`, `resetEdgeColors(vault, canvasFile)`
Types exportés : `CanvasData`, `CanvasNode`, `CanvasEdge`

### src/canvas-animator.ts
Animation CSS des edges via `MutationObserver`. Module **optionnel** — si le DOM Obsidian change
entre versions, ce module peut être désactivé sans impacter le reste.
- Injecte une balise `<style>` avec l'animation `stroke-dasharray`
- Écoute les clics sur `.canvas-node` via `addEventListener`
- Applique/retire les classes CSS sur les éléments DOM des edges
- Tout est wrappé dans `try/catch` — en cas d'erreur, `detach()` est appelé silencieusement
Export : `class CanvasAnimator` avec `attach()`, `animateEdges()`, `reset()`, `detach()`

---

## Format des notes Obsidian

Chaque note-composant doit avoir ce frontmatter pour que le lien VS Code fonctionne :

```markdown
---
file: src/mon-module/mon-fichier.ts
---

## NomDuComposant

Description...
```

Le champ `file` est un chemin **relatif** à la racine du projet (= `projectPath` dans les settings).

---

## Settings

| Clé | Défaut | Description |
|-----|--------|-------------|
| `canvasFile` | `""` | Chemin du `.canvas` dans le vault |
| `projectPath` | `"../"` | Chemin relatif vault → racine projet |
| `outputFile` | `"CONTEXT.md"` | Nom du fichier généré |

---

## Ce qui fonctionne

- Génération du `CONTEXT.md` ✅
- Menu clic-droit "Ouvrir dans VS Code" ✅
- Bouton ribbon avec icône SVG ✅ (en cours de débogage)
- Highlight edges au clic ⚠️ (en cours — `attachCanvasAnimator` ne se déclenche pas correctement)

## Ce qui est en cours

- `attachCanvasAnimator` : le check du type de vue et la récupération du `contentEl` sont à corriger.
  Piste : `leaf.view.getViewType()` au lieu de `(leaf.view as any).getViewType?.()`,
  et `containerEl` au lieu de `contentEl`.
- L'appel à `attachCanvasAnimator()` doit aussi être fait directement dans `onload()`
  pour couvrir le cas où le canvas est déjà ouvert au chargement du plugin.

## Questions ouvertes

- Le sélecteur `.canvas-node` et `dataset.id` sont-ils les bons pour cibler les nodes dans le DOM Obsidian ?
- `active-leaf-change` est-il le bon event, ou faut-il écouter `layout-change` ?