/**
 * Content of KRYSTAL_API.md — written to the project folder alongside CONTEXT.md.
 * This file teaches an AI agent how to interact with CONTEXT.md.
 */
export const KRYSTAL_API_CONTENT = `\
# Krystal API

> Ce fichier décrit comment tu peux lire et modifier \`CONTEXT.md\` pour collaborer sur ce projet.
> Il est généré automatiquement par le plugin Krystal (Obsidian) et toujours à jour.

---

## Ce que tu peux faire

1. **Modifier la prose** d'une section de note (le texte entre \`<!-- /kind-block -->\` et le prochain \`###\`)
2. **Compléter ou annoter** le diagramme Mermaid (ajouter des nœuds, des arêtes)
3. **Ajouter une nouvelle section** pour proposer un composant ou une note inexistante
4. **Répondre aux questions** des sections \`question\` en complétant leur prose

Quand tu modifies ce fichier, l'utilisateur lancera dans Obsidian :
- **"Synchroniser depuis CONTEXT.md"** → importe ta prose dans les notes vault
- **"Synchroniser canvas depuis Mermaid"** → reporte tes ajouts Mermaid dans le canvas visuel

---

## Structure d'une section

\`\`\`markdown
### NomNote <!-- vault:Notes/NomNote.md -->
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

| Marqueur dans le header | Signification | Action |
|---|---|---|
| \`<!-- vault:chemin/note.md -->\` | Section normale | ✅ Modifiable |
| \`<!-- vault:... frozen:true -->\` | Note gelée par l'utilisateur | 🚫 Ne pas toucher |
| \`<!-- vault:... plan:true -->\` | Territoire utilisateur (tâche, décision…) | ⚠️ Modifier seulement si demandé |

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

## Modifier le diagramme Mermaid

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

### Exemple complet

\`\`\`mermaid
flowchart TD
    ...
    auth_svc_01["AuthService"]:::component
    token_01{{"Token"}}:::interface
    auth_svc_01 --> token_01
    auth_svc_01 -->|"utilise"| existing_node_id
\`\`\`

---

## Ajouter une section de note

Pour proposer un nouveau composant inexistant dans le vault :

\`\`\`markdown
### NomDuComposant <!-- vault:Notes/NomDuComposant.md -->

Description du composant.
Son rôle, ses responsabilités, ses interactions clés.
\`\`\`

Lors de l'import, la note sera créée dans le vault si elle n'existe pas.

---

## Ce que tu ne dois pas faire

- ❌ Modifier \`<!-- kind-block --> ... <!-- /kind-block -->\`
- ❌ Modifier ou supprimer \`:::lock ... :::\`
- ❌ Modifier les sections avec \`frozen:true\`
- ❌ Renommer les IDs de nœuds Mermaid existants
- ❌ Modifier les lignes \`**Source :**\` et \`**Relations :**\`
- ❌ Toucher les sections \`plan:true\` sans instruction explicite de l'utilisateur

---

## Résumé du workflow

\`\`\`
Utilisateur génère CONTEXT.md
    ↓
Tu lis CONTEXT.md + KRYSTAL_API.md
    ↓
Tu modifies CONTEXT.md (prose, Mermaid, nouvelles sections)
    ↓
Utilisateur lance "Synchroniser depuis CONTEXT.md"
    → Notes vault mises à jour
Utilisateur lance "Synchroniser canvas depuis Mermaid"
    → Canvas Obsidian mis à jour
\`\`\`
`;
