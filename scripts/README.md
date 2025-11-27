# 🛠️ SCRIPTS UTILITAIRES - ARCHIVAGE C.E.R.E.R

Ce dossier contient des scripts utilitaires pour la gestion et la sécurité du système.

---

## 📋 SCRIPTS DE SÉCURITÉ

### `generate-secrets.js`

**Objectif:** Générer des secrets JWT sécurisés

**Usage:**
```bash
# Première utilisation
node scripts/generate-secrets.js

# Forcer la mise à jour du .env existant
node scripts/generate-secrets.js --force
```

**Ce qu'il fait:**
- Génère 3 secrets cryptographiques forts:
  - `JWT_SECRET` (128 caractères hex)
  - `JWT_REFRESH_SECRET` (128 caractères hex)
  - `SESSION_SECRET` (64 caractères hex)
- Crée ou met à jour le fichier `.env`
- Affiche les secrets générés
- Fournit des instructions de sécurité

**Quand l'utiliser:**
- Première installation du système
- Rotation des secrets (tous les 90 jours en production)
- Après une compromission suspectée
- Lors du passage en production

---

### `test-security.js`

**Objectif:** Valider toutes les fonctionnalités de sécurité

**Usage:**
```bash
node scripts/test-security.js
```

**Ce qu'il teste:**
1. ✅ Modules de sécurité (5 tests)
2. ✅ Configuration JWT (4 tests)
3. ✅ Configuration CORS (2 tests)
4. ✅ Système d'audit logs (5 tests)
5. ✅ Configuration HTTPS (2 tests)
6. ✅ Variables d'environnement (9 tests)
7. ✅ Bcrypt (3 tests)
8. ✅ Rate Limiting (3 tests)
9. ✅ Helmet (1 test)
10. ✅ NoSQL Injection Protection (1 test)

**Total:** 30 tests

**Résultat attendu:**
```
🎉 TOUS LES TESTS SONT PASSÉS! Sécurité opérationnelle.
```

**En cas d'échec:**
- Le script affiche les tests échoués
- Fournit des suggestions de correction
- Retourne un code d'erreur (exit code 1)

**Quand l'utiliser:**
- Après l'installation initiale
- Avant le déploiement en production
- Après toute modification de configuration
- Régulièrement (CI/CD)

---

## 🔄 WORKFLOW RECOMMANDÉ

### Installation initiale

```bash
# 1. Installer les dépendances
npm install

# 2. Générer les secrets
node scripts/generate-secrets.js

# 3. Configurer .env (MongoDB, SMTP, etc.)
nano .env

# 4. Tester la sécurité
node scripts/test-security.js

# 5. Démarrer le serveur
npm start
```

### Rotation des secrets (Production)

```bash
# 1. Générer de nouveaux secrets
node scripts/generate-secrets.js --force

# 2. Mettre à jour sur la plateforme de production
# (Render, Heroku, etc.)

# 3. Redémarrer le serveur
pm2 restart archivage-cerer

# 4. Tester
node scripts/test-security.js
```

---

## 📝 NOTES IMPORTANTES

### Sécurité

- ⚠️ **NE JAMAIS** commiter le fichier `.env`
- ⚠️ Les secrets donnent accès complet à l'application
- ⚠️ Utilisez des secrets différents pour dev/staging/production
- ⚠️ Régénérez les secrets tous les 90 jours en production

### Backup

Avant de régénérer les secrets en production:
1. Sauvegarder l'ancien `.env`
2. Prévenir les utilisateurs (tous devront se reconnecter)
3. Planifier une fenêtre de maintenance

---

## 🆘 SUPPORT

### En cas de problème

```bash
# Vérifier que Node.js est installé
node --version  # Devrait être >= 18.0.0

# Vérifier que les dépendances sont installées
npm install

# Tester manuellement la génération de secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Documentation

- Guide complet: `../SECURITE-AVANCEE.md`
- Guide de migration: `../GUIDE-MIGRATION-SECURITE.md`
- Récapitulatif: `../RECAP-SECURITE-AVANCEE.md`

---

**Développé par le Service Informatique du C.E.R.E.R**
