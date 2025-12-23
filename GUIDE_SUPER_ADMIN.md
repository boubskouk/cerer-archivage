# 🛡️ GUIDE SUPER ADMIN - NIVEAU 0

## Table des matières

1. [Introduction](#introduction)
2. [Installation et Configuration](#installation-et-configuration)
3. [Création du Compte Super Admin](#création-du-compte-super-admin)
4. [Accès au Dashboard](#accès-au-dashboard)
5. [Fonctionnalités Disponibles](#fonctionnalités-disponibles)
6. [Restrictions et Sécurité](#restrictions-et-sécurité)
7. [API Endpoints](#api-endpoints)
8. [Évolutions Futures](#évolutions-futures)

---

## Introduction

Le **Super Admin (Niveau 0)** est un compte spécial créé pour la **supervision et l'administration** du système d'archivage C.E.R.E.R.

### ⚠️ IMPORTANT

- Le Super Admin **NE FAIT PAS** d'archivage de documents
- Il **N'A PAS** de département
- Son rôle est uniquement la **SUPERVISION** du système
- Tous ses accès aux documents sont en **LECTURE SEULE**

---

## Installation et Configuration

### Prérequis

- Node.js v18+ installé
- MongoDB en cours d'exécution
- Application C.E.R.E.R déjà installée

### Fichiers Créés

Le système Super Admin ajoute les fichiers suivants à votre application :

```
backend/
├── middleware/
│   └── superAdminAuth.js          ← Authentification niveau 0
├── modules/
│   └── superadmin/
│       └── dashboard.js           ← Logique des statistiques
├── routes/
│   └── superadmin.js              ← Routes API Super Admin
├── scripts/
│   └── init-superadmin.js         ← Script de création du compte
└── public/
    ├── super-admin-login.html     ← Page de connexion
    ├── super-admin.html           ← Dashboard principal
    └── js/
        └── super-admin-dashboard.js ← Logique frontend
```

### Modifications de server.js

Seules **5 modifications mineures** ont été apportées à `server.js` :

1. Déclaration des collections Super Admin (lignes 52-54)
2. Initialisation des collections (lignes 291-293)
3. Création des index (lignes 298-301)
4. Support du niveau 0 dans getAccessibleDocuments() (lignes 183-189)
5. Chargement des modules et routes (lignes 337-357)

**Aucune ligne de code existant n'a été modifiée** - 100% additif !

---

## Création du Compte Super Admin

### Étape 1 : Lancer le script d'initialisation

```bash
node scripts/init-superadmin.js
```

### Étape 2 : Remplir les informations

Le script vous demandera :

```
Nom: Diop
Prénom: Mamadou
Email: admin@ucad.sn
Username: superadmin
Mot de passe (min. 8 caractères): ********
```

### Étape 3 : Validation

Si tout est correct, vous verrez :

```
╔════════════════════════════════════════════════════════╗
║  ✅  SUPER ADMIN CRÉÉ AVEC SUCCÈS !                   ║
╚════════════════════════════════════════════════════════╝

📋 Détails du compte:
   ID: 674b3f8a9e12345678901234
   Nom complet: Mamadou Diop
   Email: admin@ucad.sn
   Username: superadmin
   Niveau: 0 (Super Administrateur)
   Département: Aucun (supervision uniquement)
   Peut archiver: NON ❌
   Rôle: Supervision et administration système

🔐 Accès:
   URL: http://localhost:4000/super-admin-login.html
   Username: superadmin
   Mot de passe: (celui que vous avez entré)
```

### Créer des comptes Super Admin supplémentaires

Vous pouvez créer plusieurs comptes Super Admin :

```bash
node scripts/init-superadmin.js
```

Le script détectera qu'un Super Admin existe déjà et vous demandera confirmation.

---

## Accès au Dashboard

### Connexion

1. Ouvrez votre navigateur
2. Accédez à : `http://localhost:4000/super-admin-login.html`
3. Entrez vos identifiants
4. Cliquez sur **"Se connecter"**

### Redirection automatique

- Si vous êtes **niveau 0** → Accès au dashboard
- Si vous **n'êtes pas niveau 0** → Accès refusé avec message d'erreur

### Sécurité

- Toutes les tentatives d'accès sont **loggées** dans la collection `auditLogs`
- Les échecs de connexion sont **enregistrés**
- Les tentatives d'accès non autorisées déclenchent des **alertes de sécurité**

---

## Fonctionnalités Disponibles

### 1. Dashboard Principal

#### Statistiques en temps réel

- **👥 Utilisateurs**
  - Nombre total d'utilisateurs
  - Utilisateurs actifs aujourd'hui
  - Utilisateurs actifs cette semaine
  - Nouveaux utilisateurs ce mois
  - Répartition par niveau (0, 1, 2, 3)

- **📄 Documents**
  - Nombre total de documents
  - Documents créés aujourd'hui
  - Documents créés cette semaine
  - Documents créés ce mois
  - Répartition par département
  - Répartition par catégorie

- **💻 Système**
  - Utilisation CPU (%)
  - Nombre de cœurs CPU
  - Utilisation RAM (%, Go utilisés/total)
  - Uptime système (jours/heures/minutes)
  - Uptime processus Node.js

- **🔒 Sécurité**
  - Nombre d'alertes de sécurité
  - Tentatives d'accès non autorisées
  - Échecs de connexion
  - Dépassements de limites de requêtes

#### Graphiques de tendances (24h)

- **📈 Activité utilisateurs par heure**
  - Graphique ligne avec Chart.js
  - Nombre d'utilisateurs actifs par heure
  - Auto-refresh toutes les 30 secondes

- **📊 Documents créés par heure**
  - Graphique barres avec Chart.js
  - Nombre de documents créés par heure
  - Auto-refresh toutes les 30 secondes

#### Monitoring des ressources

- **Processeur**
  - Barre de progression colorée (vert/orange/rouge)
  - Pourcentage d'utilisation
  - Nombre de cœurs
  - Load average (1, 5, 15 min)

- **Mémoire**
  - Barre de progression colorée
  - Pourcentage d'utilisation
  - Go utilisés / Go totaux
  - Mémoire libre

- **Uptime**
  - Système d'exploitation
  - Processus Node.js

#### Événements de sécurité

Liste en temps réel des événements de sécurité :

- 🚫 **Tentatives d'accès non autorisé**
  - Utilisateur
  - Niveau de l'utilisateur
  - Route tentée
  - Nombre d'occurrences
  - Dernier événement

- ❌ **Échecs de connexion**
  - Username
  - Nombre de tentatives
  - Dernier échec

- ⚠️ **Dépassements de limites**
  - IP concernée
  - Type de limite
  - Nombre d'occurrences

### 2. Actions disponibles

- **🔄 Actualiser** : Recharge toutes les données
- **🚪 Déconnexion** : Se déconnecter du dashboard

### 3. Auto-refresh

Le dashboard se met à jour automatiquement toutes les **30 secondes**.

---

## Restrictions et Sécurité

### Ce que le Super Admin PEUT faire

✅ **Lecture complète**
- Voir tous les utilisateurs
- Voir tous les documents (lecture seule)
- Voir toutes les statistiques
- Voir tous les logs d'audit
- Voir les métriques système

✅ **Administration**
- Gérer les utilisateurs (à venir)
- Configurer la sécurité (à venir)
- Analyser les performances (à venir)
- Générer des rapports (à venir)

### Ce que le Super Admin NE PEUT PAS faire

❌ **Archivage**
- Créer des documents
- Modifier des documents
- Supprimer des documents
- Télécharger des fichiers pour archivage

❌ **Départements**
- Le Super Admin n'a PAS de département
- Il ne peut pas être affecté à un département

### Sécurité

#### Authentification

- Vérification du niveau 0 à **chaque requête**
- Session obligatoire
- Redirection automatique si non authentifié

#### Audit complet

Toutes les actions sont enregistrées dans `auditLogs` :

```javascript
{
  timestamp: Date,
  user: "superadmin",
  userLevel: 0,
  action: "DASHBOARD_ACCESS",
  target: { route: "/api/superadmin/dashboard/stats" },
  details: {},
  ip: "192.168.1.100",
  userAgent: "Mozilla/5.0...",
  result: "success"
}
```

#### Logs de sécurité

- **Tentatives d'accès bloquées** → `UNAUTHORIZED_SUPERADMIN_ACCESS`
- **Connexion réussie** → `LOGIN_SUCCESS`
- **Création de compte** → `SUPERADMIN_ACCOUNT_CREATED`

---

## API Endpoints

### Routes Super Admin

Toutes les routes nécessitent une authentification de niveau 0.

#### 1. Test d'authentification

```
GET /api/superadmin/test
```

**Réponse :**
```json
{
  "success": true,
  "message": "Authentification Super Admin réussie !",
  "user": {
    "username": "superadmin",
    "niveau": 0,
    "role": "Super Administrateur"
  }
}
```

#### 2. Statistiques globales

```
GET /api/superadmin/dashboard/stats
```

**Réponse :**
```json
{
  "success": true,
  "data": {
    "users": {
      "total": 125,
      "activeToday": 45,
      "activeThisWeek": 89,
      "newThisMonth": 12,
      "byLevel": {
        "niveau0": 2,
        "niveau1": 5,
        "niveau2": 38,
        "niveau3": 80
      }
    },
    "documents": {
      "total": 3456,
      "createdToday": 67,
      "createdThisWeek": 234,
      "createdThisMonth": 789,
      "byDepartment": {
        "Informatique": 1234,
        "Mathématiques": 987
      },
      "byCategory": {
        "Cours": 1500,
        "TP": 800
      }
    },
    "system": {
      "resources": {
        "cpu": {
          "usage": 45,
          "cores": 4,
          "loadAverage": [1.2, 1.5, 1.8]
        },
        "memory": {
          "total": "8 GB",
          "used": "4.5 GB",
          "percentage": 56
        },
        "uptime": {
          "system": 345600,
          "process": 3600
        }
      },
      "activity": {
        "requestsToday": 1234,
        "uploadsToday": 67,
        "downloadsToday": 234,
        "errorsToday": 5
      }
    },
    "security": {
      "events": [
        {
          "type": "UNAUTHORIZED_SUPERADMIN_ACCESS",
          "count": 3,
          "lastOccurrence": "2025-11-30T10:30:00Z"
        }
      ],
      "activeAlerts": 3
    }
  }
}
```

#### 3. Tendances utilisateurs

```
GET /api/superadmin/dashboard/trends?type=users&period=24h
```

**Paramètres :**
- `type` : "users" ou "documents"
- `period` : "24h", "7d", "30d"

**Réponse :**
```json
{
  "success": true,
  "data": [
    { "period": 0, "count": 12 },
    { "period": 1, "count": 8 },
    { "period": 2, "count": 5 },
    ...
  ]
}
```

#### 4. Tendances documents

```
GET /api/superadmin/dashboard/trends?type=documents&period=24h
```

**Réponse :** Même format que les tendances utilisateurs

---

## Évolutions Futures

Le POC actuel implémente le **Module 1 : Dashboard**.

Voici les 9 modules restants à implémenter :

### Module 2 : Gestion des Utilisateurs

- Liste complète des utilisateurs avec filtres
- Détails d'un utilisateur (profil, statistiques, activité)
- Actions : activer/désactiver, réinitialiser mot de passe
- Historique des connexions

### Module 3 : Gestion des Documents

- Liste complète des documents avec recherche avancée
- Analyse par département, catégorie, taille
- Détection des documents orphelins
- Statistiques de stockage

### Module 4 : Logs et Audit

- Recherche dans les logs d'audit
- Filtres : date, utilisateur, action, résultat
- Export des logs (CSV, JSON)
- Analyse de patterns suspects

### Module 5 : Sécurité Avancée

- Gestion des règles IP (whitelist/blacklist)
- Configuration du rate limiting
- Détection d'intrusions
- Alertes en temps réel

### Module 6 : Performance

- Statistiques MongoDB (slow queries, index usage)
- Analyse des requêtes lentes
- Recommandations d'optimisation
- Monitoring des collections

### Module 7 : Rapports

- Génération de rapports PDF
- Export Excel des statistiques
- Rapports programmés (quotidiens, hebdomadaires, mensuels)
- Envoi automatique par email

### Module 8 : Maintenance

- Gestion des backups (lancer, restaurer)
- Nettoyage des données obsolètes
- Optimisation de la base de données
- Tâches planifiées

### Module 9 : Notifications

- Configuration des alertes email
- Webhooks pour notifications externes
- Seuils configurables (CPU, RAM, erreurs)
- Historique des notifications

### Module 10 : Support et Diagnostics

- Health checks du système
- Tests de connectivité
- Diagnostics de performance
- Logs de débogage

---

## Maintenance et Support

### Logs

Les logs du serveur contiennent des informations sur le Super Admin :

```
✅ Middleware Super Admin initialisé
✅ Module Dashboard initialisé
✅ Routes Super Admin initialisées
✅ Routes Super Admin (Niveau 0) chargées
```

### Collections MongoDB

Nouvelles collections créées :

- **auditLogs** : Tous les logs d'audit
- **ipRules** : Règles de filtrage IP (à venir)

### Dépannage

#### Le dashboard ne charge pas

1. Vérifiez que vous êtes bien connecté
2. Vérifiez que votre compte est niveau 0
3. Consultez la console du navigateur (F12)
4. Vérifiez les logs serveur

#### Erreur "Non authentifié"

1. Reconnectez-vous via `/super-admin-login.html`
2. Vérifiez que les cookies sont activés
3. Vérifiez la session MongoDB

#### Les statistiques sont à 0

1. Vérifiez que MongoDB contient des données
2. Vérifiez les collections (users, documents, etc.)
3. Consultez les logs d'erreur du serveur

---

## Sécurité et Bonnes Pratiques

### Recommandations

1. **Mot de passe fort** : Min 12 caractères, majuscules, minuscules, chiffres, symboles
2. **Sessions sécurisées** : Déconnexion après usage
3. **Accès limité** : Ne partagez pas les identifiants Super Admin
4. **Audit régulier** : Consultez les logs régulièrement
5. **Backups** : Sauvegardez la base de données régulièrement

### En production

- Utilisez HTTPS obligatoirement
- Configurez un pare-feu
- Limitez l'accès par IP si possible
- Activez les notifications d'alertes
- Sauvegardez les logs d'audit

---

## Contacts et Support

Pour toute question ou problème :

1. Consultez ce guide
2. Consultez les fichiers d'analyse :
   - `ANALYSE_NIVEAU_0_SUPER_ADMIN.md`
   - `PLAN_IMPLEMENTATION_NIVEAU_0.md`
3. Consultez les logs serveur
4. Contactez l'administrateur système

---

**Archivage C.E.R.E.R - Super Admin Dashboard v1.0**

*Dernière mise à jour : 30 novembre 2025*
