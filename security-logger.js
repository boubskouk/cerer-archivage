// ============================================
// SYSTÈME DE LOGS DE SÉCURITÉ - GED CERER
// ============================================

// Niveaux de gravité
const SEVERITY = {
    INFO: 'INFO',           // Vert - Actions normales, erreurs mineures
    WARNING: 'WARNING',     // Orange - Comportement suspect
    CRITICAL: 'CRITICAL'    // Rouge - Menace sécurité, violations graves
};

// Types d'événements de sécurité pour GED
const EVENT_TYPES = {
    // Authentification
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGIN_FAILED_REPEATED: 'LOGIN_FAILED_REPEATED', // 3+ tentatives
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGOUT: 'LOGOUT',

    // Session
    SESSION_VIOLATION: 'SESSION_VIOLATION', // Multi-session détectée
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    SESSION_HIJACKING_ATTEMPT: 'SESSION_HIJACKING_ATTEMPT',

    // Accès
    UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
    ACCESS_DENIED: 'ACCESS_DENIED',
    ADMIN_PAGE_ACCESS_BLOCKED: 'ADMIN_PAGE_ACCESS_BLOCKED',

    // Super Admin
    ADMIN_LOGIN_BLOCKED: 'ADMIN_LOGIN_BLOCKED', // Niveau 0 via page normale
    ADMIN_DELETE_ATTEMPT: 'ADMIN_DELETE_ATTEMPT', // Tentative suppression admin

    // Modifications suspectes
    UNAUTHORIZED_MODIFICATION: 'UNAUTHORIZED_MODIFICATION',
    UNAUTHORIZED_DELETION: 'UNAUTHORIZED_DELETION',
    BULK_DELETION: 'BULK_DELETION', // Suppression massive

    // Fichiers/Dossiers
    FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
    FILE_DOWNLOAD_SUSPICIOUS: 'FILE_DOWNLOAD_SUSPICIOUS',
    BULK_DOWNLOAD: 'BULK_DOWNLOAD', // Téléchargement massif

    // Privilèges
    PRIVILEGE_ESCALATION: 'PRIVILEGE_ESCALATION',
    ROLE_MODIFICATION_ATTEMPT: 'ROLE_MODIFICATION_ATTEMPT',

    // Activité suspecte
    SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
    RAPID_REQUESTS: 'RAPID_REQUESTS', // Trop de requêtes
    SQL_INJECTION_ATTEMPT: 'SQL_INJECTION_ATTEMPT',
    XSS_ATTEMPT: 'XSS_ATTEMPT',

    // Données
    DATA_BREACH_ATTEMPT: 'DATA_BREACH_ATTEMPT',
    SENSITIVE_DATA_ACCESS: 'SENSITIVE_DATA_ACCESS'
};

// Mapping type → gravité par défaut
const EVENT_SEVERITY_MAP = {
    // INFO (Vert)
    [EVENT_TYPES.LOGIN_SUCCESS]: SEVERITY.INFO,
    [EVENT_TYPES.LOGOUT]: SEVERITY.INFO,
    [EVENT_TYPES.SESSION_EXPIRED]: SEVERITY.INFO,
    [EVENT_TYPES.ACCESS_DENIED]: SEVERITY.INFO,

    // WARNING (Orange)
    [EVENT_TYPES.LOGIN_FAILED]: SEVERITY.WARNING,
    [EVENT_TYPES.UNAUTHORIZED_ACCESS]: SEVERITY.WARNING,
    [EVENT_TYPES.FILE_ACCESS_DENIED]: SEVERITY.WARNING,
    [EVENT_TYPES.UNAUTHORIZED_MODIFICATION]: SEVERITY.WARNING,
    [EVENT_TYPES.FILE_DOWNLOAD_SUSPICIOUS]: SEVERITY.WARNING,

    // CRITICAL (Rouge)
    [EVENT_TYPES.LOGIN_FAILED_REPEATED]: SEVERITY.CRITICAL,
    [EVENT_TYPES.SESSION_VIOLATION]: SEVERITY.CRITICAL,
    [EVENT_TYPES.SESSION_HIJACKING_ATTEMPT]: SEVERITY.CRITICAL,
    [EVENT_TYPES.ADMIN_LOGIN_BLOCKED]: SEVERITY.CRITICAL,
    [EVENT_TYPES.ADMIN_DELETE_ATTEMPT]: SEVERITY.CRITICAL,
    [EVENT_TYPES.ADMIN_PAGE_ACCESS_BLOCKED]: SEVERITY.CRITICAL,
    [EVENT_TYPES.UNAUTHORIZED_DELETION]: SEVERITY.CRITICAL,
    [EVENT_TYPES.BULK_DELETION]: SEVERITY.CRITICAL,
    [EVENT_TYPES.BULK_DOWNLOAD]: SEVERITY.CRITICAL,
    [EVENT_TYPES.PRIVILEGE_ESCALATION]: SEVERITY.CRITICAL,
    [EVENT_TYPES.ROLE_MODIFICATION_ATTEMPT]: SEVERITY.CRITICAL,
    [EVENT_TYPES.SUSPICIOUS_ACTIVITY]: SEVERITY.CRITICAL,
    [EVENT_TYPES.RAPID_REQUESTS]: SEVERITY.CRITICAL,
    [EVENT_TYPES.SQL_INJECTION_ATTEMPT]: SEVERITY.CRITICAL,
    [EVENT_TYPES.XSS_ATTEMPT]: SEVERITY.CRITICAL,
    [EVENT_TYPES.DATA_BREACH_ATTEMPT]: SEVERITY.CRITICAL,
    [EVENT_TYPES.SENSITIVE_DATA_ACCESS]: SEVERITY.CRITICAL
};

// Messages utilisateur-friendly pour chaque type
const EVENT_MESSAGES = {
    [EVENT_TYPES.LOGIN_FAILED]: 'Échec de connexion',
    [EVENT_TYPES.LOGIN_FAILED_REPEATED]: 'Tentatives de connexion répétées échouées',
    [EVENT_TYPES.SESSION_VIOLATION]: 'Violation de session - Multi-connexion détectée',
    [EVENT_TYPES.ADMIN_LOGIN_BLOCKED]: 'Tentative de connexion Super Admin via page non autorisée',
    [EVENT_TYPES.ADMIN_DELETE_ATTEMPT]: 'Tentative de suppression d\'un compte Super Admin',
    [EVENT_TYPES.UNAUTHORIZED_DELETION]: 'Tentative de suppression non autorisée',
    [EVENT_TYPES.PRIVILEGE_ESCALATION]: 'Tentative d\'élévation de privilèges',
    [EVENT_TYPES.BULK_DOWNLOAD]: 'Téléchargement massif détecté',
    [EVENT_TYPES.FILE_ACCESS_DENIED]: 'Accès à un fichier refusé',
    [EVENT_TYPES.UNAUTHORIZED_ACCESS]: 'Accès non autorisé',
    [EVENT_TYPES.SUSPICIOUS_ACTIVITY]: 'Activité suspecte détectée'
};

/**
 * Classe SecurityLogger pour gérer les logs de sécurité
 */
class SecurityLogger {
    constructor(db) {
        this.db = db;
        this.collection = db.collection('securityLogs');

        // Créer index pour optimiser les requêtes
        this.createIndexes();
    }

    async createIndexes() {
        try {
            await this.collection.createIndex({ timestamp: -1 });
            await this.collection.createIndex({ severity: 1 });
            await this.collection.createIndex({ eventType: 1 });
            await this.collection.createIndex({ username: 1 });
            await this.collection.createIndex({ ip: 1 });
        } catch (error) {
            console.error('Erreur création index securityLogs:', error);
        }
    }

    /**
     * Logger un événement de sécurité
     */
    async log(eventType, username, details = {}, req = null) {
        const severity = EVENT_SEVERITY_MAP[eventType] || SEVERITY.WARNING;
        const message = EVENT_MESSAGES[eventType] || eventType;

        const logEntry = {
            timestamp: new Date(),
            eventType,
            severity,
            message,
            username: username || 'unknown',
            ip: req?.ip || details.ip || 'unknown',
            userAgent: req?.headers?.['user-agent'] || details.userAgent || 'unknown',
            details: {
                ...details,
                url: req?.originalUrl,
                method: req?.method
            }
        };

        try {
            await this.collection.insertOne(logEntry);

            // Console log avec couleur selon gravité
            const emoji = severity === SEVERITY.CRITICAL ? '🔴' :
                         severity === SEVERITY.WARNING ? '🟠' : '🟢';
            console.log(`${emoji} [${severity}] ${eventType}: ${username} - ${message}`);

            return logEntry;
        } catch (error) {
            console.error('Erreur logging sécurité:', error);
        }
    }

    /**
     * Détecter tentatives répétées (3+ échecs en 15 min)
     */
    async checkRepeatedFailures(username, ip) {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        const failureCount = await this.collection.countDocuments({
            eventType: EVENT_TYPES.LOGIN_FAILED,
            username,
            ip,
            timestamp: { $gte: fifteenMinutesAgo }
        });

        if (failureCount >= 3) {
            await this.log(EVENT_TYPES.LOGIN_FAILED_REPEATED, username, {
                failureCount,
                timeWindow: '15 minutes',
                ip
            });
            return true;
        }

        return false;
    }

    /**
     * Récupérer les logs avec filtres
     */
    async getLogs(filters = {}) {
        const query = {};

        if (filters.severity) {
            query.severity = filters.severity;
        }

        if (filters.eventType) {
            query.eventType = filters.eventType;
        }

        if (filters.username) {
            query.username = new RegExp(filters.username, 'i');
        }

        if (filters.ip) {
            query.ip = filters.ip;
        }

        if (filters.startDate || filters.endDate) {
            query.timestamp = {};
            if (filters.startDate) {
                query.timestamp.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.timestamp.$lte = new Date(filters.endDate);
            }
        }

        const logs = await this.collection
            .find(query)
            .sort({ timestamp: -1 })
            .limit(filters.limit || 100)
            .toArray();

        return logs;
    }

    /**
     * Obtenir statistiques des logs
     */
    async getStats(days = 7) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const stats = await this.collection.aggregate([
            { $match: { timestamp: { $gte: startDate } } },
            {
                $group: {
                    _id: '$severity',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const result = {
            [SEVERITY.INFO]: 0,
            [SEVERITY.WARNING]: 0,
            [SEVERITY.CRITICAL]: 0
        };

        stats.forEach(stat => {
            result[stat._id] = stat.count;
        });

        return result;
    }
}

module.exports = {
    SecurityLogger,
    SEVERITY,
    EVENT_TYPES,
    EVENT_MESSAGES
};
