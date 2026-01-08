// ============================================
// SYSTÈME DE MESSAGERIE SUPER ADMIN
// ============================================

let currentReplyMessageId = null;

// Charger les messages
async function loadMessages() {
    try {
        const response = await fetch('/api/messages', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Erreur chargement messages');
        }

        const data = await response.json();
        renderMessages(data.messages || []);

        // Mettre à jour le compteur de messages non lus
        const unreadCount = data.messages.filter(m => !m.read).length;
        updateUnreadCount(unreadCount);

    } catch (error) {
        console.error('Erreur chargement messages:', error);
        document.getElementById('messagesList').innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                ❌ Erreur lors du chargement des messages
            </div>
        `;
    }
}

// Afficher les messages
function renderMessages(messages) {
    const messagesList = document.getElementById('messagesList');

    if (messages.length === 0) {
        messagesList.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #94a3b8;">
                📭 Aucun message pour le moment
            </div>
        `;
        return;
    }

    let html = '';
    messages.forEach(msg => {
        const isUnread = !msg.read;
        const hasReplies = msg.replies && msg.replies.length > 0;

        html += `
            <div style="border: 2px solid ${isUnread ? '#667eea' : '#e2e8f0'}; border-radius: 12px; padding: 20px; margin-bottom: 16px; background: ${isUnread ? '#f0f4ff' : 'white'};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div>
                        <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">
                            ${isUnread ? '🔵 ' : ''}${msg.fromName}
                        </div>
                        <div style="font-size: 12px; color: #64748b;">
                            ${msg.fromEmail} • ${new Date(msg.date).toLocaleString('fr-FR')}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        ${isUnread ? '<span style="background: #667eea; color: white; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 600;">NOUVEAU</span>' : ''}
                        ${hasReplies ? '<span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 600;">✓ RÉPONDU</span>' : ''}
                    </div>
                </div>

                <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #667eea;">
                    <p style="margin: 0; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${msg.message}</p>
                </div>

                ${hasReplies ? `
                    <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #10b981;">
                        <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 8px;">
                            💬 VOS RÉPONSES (${msg.replies.length})
                        </div>
                        ${msg.replies.map(reply => `
                            <div style="background: white; padding: 12px; border-radius: 6px; margin-bottom: 8px;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">
                                    ${new Date(reply.date).toLocaleString('fr-FR')}
                                </div>
                                <p style="margin: 0; color: #1e293b; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${reply.message}</p>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <button onclick="openReplyModal('${msg._id}')" style="padding: 10px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px;">
                    💬 ${hasReplies ? 'Répondre à nouveau' : 'Répondre'}
                </button>
            </div>
        `;
    });

    messagesList.innerHTML = html;
}

// Mettre à jour le compteur de messages non lus
function updateUnreadCount(count) {
    const badge = document.getElementById('unreadMessagesCount');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

// Ouvrir le modal de réponse
async function openReplyModal(messageId) {
    currentReplyMessageId = messageId;

    // Récupérer le message
    const response = await fetch('/api/messages', { credentials: 'include' });
    const data = await response.json();
    const message = data.messages.find(m => m._id === messageId);

    if (!message) {
        alert('Message non trouvé');
        return;
    }

    // Afficher le contenu du message original
    document.getElementById('replyModalContent').innerHTML = `
        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border-left: 4px solid #667eea;">
            <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 8px;">
                MESSAGE DE ${message.fromName}
            </div>
            <p style="margin: 0; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${message.message}</p>
        </div>
    `;

    // Réinitialiser le champ de réponse
    document.getElementById('replyText').value = '';

    // Afficher le modal
    document.getElementById('replyModal').style.display = 'flex';

    // Marquer le message comme lu
    markAsRead(messageId);
}

// Fermer le modal
function closeReplyModal() {
    document.getElementById('replyModal').style.display = 'none';
    currentReplyMessageId = null;
}

// Envoyer une réponse
async function sendReply() {
    const replyText = document.getElementById('replyText').value.trim();

    if (!replyText) {
        alert('Veuillez écrire une réponse');
        return;
    }

    if (!currentReplyMessageId) {
        alert('Erreur: aucun message sélectionné');
        return;
    }

    try {
        const response = await fetch(`/api/messages/${currentReplyMessageId}/reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ reply: replyText })
        });

        if (!response.ok) {
            throw new Error('Erreur envoi réponse');
        }

        // Fermer le modal
        closeReplyModal();

        // Recharger les messages
        await loadMessages();

        // Notification
        alert('✅ Réponse envoyée avec succès !');

    } catch (error) {
        console.error('Erreur envoi réponse:', error);
        alert('❌ Erreur lors de l\'envoi de la réponse');
    }
}

// Marquer un message comme lu
async function markAsRead(messageId) {
    try {
        await fetch(`/api/messages/${messageId}/read`, {
            method: 'PUT',
            credentials: 'include'
        });

        // Recharger les messages
        await loadMessages();
    } catch (error) {
        console.error('Erreur marquage lu:', error);
    }
}

// Hook pour charger les messages quand on ouvre la section
document.addEventListener('DOMContentLoaded', function() {
    // Sauvegarder la fonction navigateToSection originale
    if (typeof navigateToSection !== 'undefined') {
        const originalNavigate = navigateToSection;
        window.navigateToSection = function(section) {
            originalNavigate(section);
            if (section === 'messages') {
                setTimeout(() => loadMessages(), 100);
            }
        };
    }
});
