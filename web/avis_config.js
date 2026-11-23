// Envoi de l'avis (cycle 6b, décision du responsable du projet) : directement depuis la page vers Web3Forms, qui le
// transmet par mail. Aucune adresse mail dans la page. La clé est publique par conception : elle permet seulement
// d'envoyer un message à la boîte prévue. Seul fichier où figure l'adresse du service (vérifié par les tests).
export const ADRESSE_AVIS = 'https://api.web3forms.com/submit';
export const CLE_AVIS = '90891c03-eaad-4e95-871a-1cfac51d0012';
export const SUJET_AVIS = '[checkmypay] avis';
