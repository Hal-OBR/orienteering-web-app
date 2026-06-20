// config.jsへコピーし、SupabaseのProject Settings > APIにある値を設定します。
// anon key / publishable keyはブラウザ公開を前提としたキーです。
// service_role keyは絶対に設定しないでください。
window.ORIENTEERING_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLISHABLE_OR_ANON_KEY"
};
