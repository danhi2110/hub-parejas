// ==============================================================================
// HUB INTERACTIVO DE PAREJAS - CLIENTE SUPABASE (JS Vanilla con CDN ESM)
// ==============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// REEMPLAZA ESTOS VALORES CON LOS DE TU PROYECTO DE SUPABASE (Settings > API)
export const SUPABASE_URL = 'https://lijeqxhzqonmlstgpupy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpamVxeGh6cW9ubWxzdGdwdXB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1OTY0ODAsImV4cCI6MjEwNTE3MjQ4MH0.-SkxifwffYeEkAFAmR7Gp82l9ANymvWRRzDqrDGnSyY';

export const isConfigured = () => {
  return (
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('TU-PROYECTO') &&
    !SUPABASE_ANON_KEY.includes('TU-ANON-KEY')
  );
};

// Instancia global del cliente de Supabase
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  }
});

// Verificación visual en consola para facilitar debugging al desarrollador
if (!isConfigured()) {
  console.warn(
    '⚠️ Supabase aún no está configurado. Por favor, edita js/supabaseClient.js con tu SUPABASE_URL y SUPABASE_ANON_KEY.'
  );
}
