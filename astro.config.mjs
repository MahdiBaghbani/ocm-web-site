// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

function normalizeBasePath(value) {
  if (!value) {
    return '/';
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const segments = trimmed.replace(/^\/+|\/+$/g, '');
  return segments ? `/${segments}/` : '/';
}

const base = normalizeBasePath(process.env.ASTRO_BASE);
const site = process.env.ASTRO_SITE;

// https://astro.build/config
export default defineConfig({
  base,
  ...(site ? { site } : {}),
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()]
  }
});