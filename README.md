# Wish.ia

L'inventaire de mes wishlists, organisées par listes (Sport, Maison, Tech, Mode…). Pour chaque objet : sa photo, son nom, son prix, sa date d'ajout et le lien vers le site. Coller le lien d'un produit pré-remplit la fiche.

App web personnelle, installable sur iPhone (PWA) et utilisable sur ordinateur. Interface en français.

## Installer sur iPhone

Ouvrir l'app dans Safari, puis Partager → « Sur l'écran d'accueil ». Elle s'ouvre ensuite en plein écran, sous le nom « Wish.ia ».

## Technique

Même structure que Coach.ia et Brain.ia :

- HTML, CSS et JavaScript purs : pas de build, pas de dépendances à installer.
- Données dans le projet Supabase « Divers.ia » : tables `wishia_*`, bucket privé `wishia`, connexion par email et mot de passe, RLS sur toutes les tables.
- « Supprimer » archive (colonne `archived_at`) : rien n'est effacé de la base.
- Hébergement : GitHub Pages.

## Lancer en local

```bash
python3 devserver.py
```

Puis ouvrir http://localhost:5506.

## Configuration

Il n'y a pas de fichier `.env` : l'app n'a aucun secret côté navigateur.

- `js/supabase-config.js` contient l'URL du projet et la clé publique « anon ». Elles sont publiques par design : la sécurité vient des règles RLS.
- La clé `service_role` n'est utilisée nulle part et ne doit jamais entrer dans ce dépôt.

## Base de données

Les scripts SQL sont dans `supabase/migrations/`, à exécuter dans l'ordre dans l'éditeur SQL du projet « Divers.ia ». Ils ne touchent qu'aux objets préfixés `wishia`.

## Edge Function

`supabase/functions/wishia-fetch-product/` reçoit le lien d'un produit, télécharge la page et renvoie la photo, le nom et le prix (Open Graph, puis JSON-LD, puis Twitter, puis `<title>`). L'app s'en sert pour pré-remplir la fiche.

Elle n'a besoin d'aucun secret : `SUPABASE_URL` et `SUPABASE_ANON_KEY` sont fournis automatiquement par Supabase, et la clé `service_role` n'est pas utilisée.

### Déployer depuis le tableau de bord (comme `coach-calendar`)

1. Projet « Divers.ia » → Edge Functions → Deploy a new function → Via Editor.
2. Nom de la fonction : `wishia-fetch-product`.
3. Coller le contenu de `supabase/functions/wishia-fetch-product/index.ts`, puis Deploy.
4. Dans les réglages de la fonction, laisser « Verify JWT » **activé**.

Pour mettre à jour la fonction : même éditeur, coller la nouvelle version, Deploy.

### Ou avec la CLI Supabase

```bash
supabase functions deploy wishia-fetch-product --project-ref eqydrejfdpusuvydcjdp
```

### Réserver la fonction à un seul compte (facultatif)

La fonction refuse déjà tout appel sans session. Pour la limiter à un compte précis, ajouter le secret `WISHIA_ALLOWED_USER_ID` (Edge Functions → Secrets) avec l'identifiant du compte, visible dans Authentication → Users.

### Vérifier

Sans session, la fonction doit répondre 401 :

```bash
curl -i -X POST https://eqydrejfdpusuvydcjdp.supabase.co/functions/v1/wishia-fetch-product -H "Content-Type: application/json" -d '{"url":"https://www.apple.com/fr/"}'
```

## Sauvegardes et anti-veille

- Sauvegarde nocturne des tables : dépôt `supabase-backups`.
- Anti-veille du projet Supabase : dépôt `supabase-keepalive`, qui garde déjà « Divers.ia » actif.
- Dans l'app : le bouton « Exporter mes données », en bas de page, télécharge toutes les listes et tous les objets en JSON (éléments supprimés compris). Les photos ne sont pas dans le fichier : seul leur chemin dans le bucket y figure.
