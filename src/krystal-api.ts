/**
 * Content of KRYSTAL_API.md — written to the project folder alongside CONTEXT.md.
 * This file teaches an AI agent how to interact with the .krystal/ workspace.
 */
export const KRYSTAL_API_CONTENT = `\
# Krystal API

> Ce fichier décrit comment tu peux lire et modifier les fichiers \`.krystal/\` pour collaborer sur ce projet.
> Il est généré automatiquement par le plugin Krystal (Obsidian) et toujours à jour.

---

## Structure des fichiers

\`\`\`
projet/
├── CONTEXT.md              ← index : titre + diagramme Mermaid complet + liens vers les specs
└── .krystal/
    ├── KRYSTAL_API.md      ← ce fichier
    ├── plan/
    │   └── <NomNote>.md   ← une spec par note de kind "plan" (territoire utilisateur)
    └── code/
        └── <NomNote>.md   ← une spec par note de kind "code" (territoire IA)
\`\`\`

**CONTEXT.md** = lecture seule pour toi. C'est l'index : il contient le diagramme Mermaid et les liens vers les specs.
**Les fichiers \`.krystal/plan/\` et \`.krystal/code/\`** = c'est là que tu travailles.

---

## Ce que tu peux faire

1. **Modifier la prose** d'une section de spec (le texte en dehors des zones protégées)
2. **Ajouter une nouvelle section** dans un fichier \`.krystal/code/\` pour proposer un composant inexistant
3. **Compléter ou annoter** le diagramme Mermaid dans CONTEXT.md (ajouter des nœuds, des arêtes)
4. **Répondre aux questions** des sections \`question\` en complétant leur prose

Quand tu modifies ces fichiers, l'utilisateur lancera dans Obsidian :
- **"Synchroniser (notes + canvas)"** → importe ta prose dans les notes vault ET reporte tes ajouts Mermaid dans le canvas visuel

---

## Structure d'une section de spec

\`\`\`markdown
### NomNote <!-- vault:Notes/NomNote.md kind:component -->
**Source :** [src/fichier.ts](vscode://...)   ← ne pas modifier
**Relations :** → **Autre** · ← **Troisième** ← ne pas modifier

<!-- kind-block -->                  ← ZONE AUTO-GÉNÉRÉE — ne pas modifier
interface NomNote {
  field: string;
}
<!-- /kind-block -->

Corps de la note.                    ← ✅ ZONE MODIFIABLE
Tu peux écrire ici librement.
\`\`\`

---

## Marqueurs de section

| Attribut dans le header | Signification | Action |
|---|---|---|
| \`kind:component\` (ou autre kind) | Type de la note | Utilisé à la création |
| \`frozen:true\` | Note gelée par l'utilisateur | 🚫 Ne pas toucher |
| \`plan:true\` | Territoire utilisateur (tâche, décision…) | ⚠️ Modifier seulement si demandé |

---

## Zones protégées dans une section

### Blocs kind (auto-générés)
\`\`\`
<!-- kind-block -->
... contenu généré depuis le frontmatter de la note ...
<!-- /kind-block -->
\`\`\`
→ Ne jamais modifier. Ce contenu est régénéré à chaque export.

### Blocs lock (validés manuellement)
\`\`\`
:::lock
Ce texte a été validé manuellement par l'utilisateur.
Ne pas modifier, déplacer ni supprimer ce bloc.
:::
\`\`\`
→ Si tu déplaces ou supprimes un bloc \`:::lock\`, la version originale sera restaurée lors de l'import.

---

## Modifier le diagramme Mermaid (dans CONTEXT.md)

Le bloc Mermaid est le **langage commun** entre toi et le canvas Obsidian.
Les IDs de nœuds sont les identifiants canvas réels — **ne jamais les renommer**.

### Ajouter un nœud

\`\`\`
<id_unique>["Label"]:::kindName
\`\`\`

L'ID doit être une chaîne alphanumérique unique (ex: \`auth_service_01\`).
Il deviendra l'identifiant du nœud canvas lors de la synchronisation.

### Ajouter une arête

\`\`\`
id1 --> id2
id1 -->|"description du lien"| id2
\`\`\`

### Kinds disponibles et leurs formes Mermaid

**Kinds Plan — territoire utilisateur** (violet dans le canvas)

| Kind | Forme Mermaid | Usage |
|---|---|---|
| \`epic\` | \`(("Label"))\` double cercle | Objectif de haut niveau |
| \`task\` | \`["Label"]\` rectangle | Tâche actionnable |
| \`milestone\` | \`(["Label"])\` stade | Livrable daté |
| \`decision\` | \`{"Label"}\` losange | Décision architecturale |
| \`question\` | \`["Label ?"]\` rectangle | Question ouverte |
| \`spec\` | \`[/"Label"/]\` parallélogramme | Spécification technique |

**Kinds Code — territoire IA** (bleu dans le canvas)

| Kind | Forme Mermaid | Usage |
|---|---|---|
| \`component\` | \`["Label"]\` rectangle | Module ou classe |
| \`interface\` | \`{{"Label"}}\` hexagone | Contrat ou structure |
| \`type\` | \`[/"Label"/]\` parallélogramme | Alias de type |
| \`enum\` | \`{"Label"}\` losange | Ensemble de valeurs |
| \`config\` | \`[("Label")]\` cylindre | Options de configuration |
| \`media\` | \`[/"Label"\\]\` trapèze | Asset média |
| \`file\` | \`["Label"]\` rectangle | Référence fichier |

---

## Ajouter une section de note (proposer un nouveau composant)

Dans un fichier \`.krystal/code/NomDuComposant.md\` :

\`\`\`markdown
### NomDuComposant <!-- vault:Notes/NomDuComposant.md kind:component -->

Description du composant.
Son rôle, ses responsabilités, ses interactions clés.
\`\`\`

Et dans le diagramme Mermaid de CONTEXT.md, ajouter le nœud et ses relations :

\`\`\`mermaid
flowchart TD
    ...
    auth_svc_01["AuthService"]:::component
    auth_svc_01 -->|"utilise"| existing_node_id
\`\`\`

Lors de l'import, la note sera créée dans le vault si elle n'existe pas, avec le template correspondant au kind.

---

## Ce que tu ne dois pas faire

- ❌ Modifier \`<!-- kind-block --> ... <!-- /kind-block -->\`
- ❌ Modifier ou supprimer \`:::lock ... :::\`
- ❌ Modifier les sections avec \`frozen:true\`
- ❌ Renommer les IDs de nœuds Mermaid existants dans CONTEXT.md
- ❌ Modifier les lignes \`**Source :**\` et \`**Relations :**\`
- ❌ Toucher les sections \`plan:true\` sans instruction explicite de l'utilisateur

---

## Résumé du workflow

\`\`\`
Utilisateur génère le contexte (bouton Krystal)
    ↓
.krystal/plan/*.md et .krystal/code/*.md créés
CONTEXT.md créé (index + Mermaid complet)
    ↓
Tu lis les fichiers .krystal/ et CONTEXT.md
    ↓
Tu modifies les specs (prose, Mermaid, nouvelles sections)
    ↓
Utilisateur lance "Synchroniser (notes + canvas)"
    → Notes vault mises à jour depuis .krystal/
    → Canvas Obsidian mis à jour depuis le Mermaid de CONTEXT.md
\`\`\`
`;
