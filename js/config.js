/*
 * Configuration de la connexion à Supabase.
 * Remplacez les deux valeurs ci-dessous par celles de votre projet :
 * Supabase > Project Settings > API (ou "API Keys").
 *
 * La clé à mettre ici est la clé PUBLIQUE ("anon" ou "publishable").
 * Elle est faite pour être visible dans le navigateur : avec elle, un
 * visiteur ne peut appeler QUE les fonctions citoyennes prévues dans
 * supabase/schema.sql. Ne mettez JAMAIS ici la clé "service_role" / "secret".
 */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://VOTRE-PROJET.supabase.co',
  SUPABASE_ANON_KEY: 'VOTRE_CLE_PUBLIQUE_ANON'
};
