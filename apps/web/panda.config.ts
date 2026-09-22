import { defineConfig } from '@pandacss/dev';

import { globalCss, globalFontface, theme } from './src/theme';

export default defineConfig({
  presets: ['@pandacss/preset-base'],
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  exclude: ['./src/**/*.test.{ts,tsx}'],
  outdir: 'styled-system',
  theme,
  globalCss,
  globalFontface,
  // Shared elements receive recipe variants through props, outside static extraction.
  staticCss: { recipes: { badge: ['*'], callout: ['*'], button: ['*'] } },
});
