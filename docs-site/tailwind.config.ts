import { createPreset } from 'fumadocs-ui/tailwind-plugin';

/** @type {import('tailwindcss').Config} */
const config = {
  presets: [
    createPreset({
      // Expose colors globally (e.g. bg-background, text-foreground)
      addGlobalColors: true,
    }),
  ],
  content: [
    './app/**/*.{ts,tsx}',
    './content/**/*.mdx',
    './lib/**/*.{ts,tsx}',
    './node_modules/fumadocs-ui/dist/**/*.js',
  ],
};

export default config;
