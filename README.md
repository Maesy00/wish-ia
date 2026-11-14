# Wish.ia

L'inventaire de mes wishlists, organisées par listes (Sport, Maison, Tech, Mode…). Pour chaque objet : sa photo, son nom, son prix, sa date d'ajout et le lien vers le site. Coller le lien d'un produit pré-remplit la fiche.

App web personnelle, installable sur iPhone (PWA) et utilisable sur ordinateur. Interface en français.

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

`supabase/functions/wishia-fetch-product/` récupère la photo, le nom et le prix d'un produit à partir de son lien. Les instructions de déploiement seront ajoutées avec la fonction.

## Sauvegardes et anti-veille

- Sauvegarde nocturne des tables : dépôt `supabase-backups`.
- Anti-veille du projet Supabase : dépôt `supabase-keepalive`, qui garde déjà « Divers.ia » actif.
- Dans l'app : bouton « Exporter mes données » (JSON).
