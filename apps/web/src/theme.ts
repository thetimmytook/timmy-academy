/* Panda extracts literal token names from these declarative style objects. */
/* eslint-disable sonarjs/no-duplicate-string */
import { defineGlobalStyles, defineGlobalFontface, defineRecipe } from '@pandacss/dev';

import type { Config } from '@pandacss/dev';

// Academy's shared visual language. Keep feature layouts in their owning screens.
// Rem values use a 16px design reference; the browser controls the actual root size.
const palette = {
  neutral: {
    950: '#0B1115',
    900: '#10181D',
    850: '#142027',
    800: '#19252C',
    700: '#26343D',
    600: '#3A4953',
    500: '#61707A',
    400: '#8C989F',
    300: '#B6C0C5',
    200: '#D3DADD',
    100: '#E9EDEF',
    50: '#F6F8F8',
  },
  green: {
    950: '#0D2419',
    900: '#123321',
    800: '#18452D',
    700: '#215C3B',
    600: '#2D774C',
    500: '#3E9660',
    400: '#57B978',
    300: '#7ACE96',
    200: '#A8E1B7',
    100: '#D4F1DC',
  },
  blue: {
    950: '#101F2D',
    800: '#173C63',
    700: '#20558A',
    600: '#2C6FB2',
    500: '#3A86D8',
    400: '#5C9BE1',
    300: '#88B6EA',
  },
  amber: { 950: '#292113', 700: '#7A5519', 600: '#93691E', 500: '#B48329', 400: '#D2A44B' },
  red: {
    950: '#2C1919',
    700: '#753833',
    600: '#91463F',
    500: '#B45A50',
    400: '#D3766C',
    300: '#E79A91',
  },
};

const focus = { outline: '2px solid', outlineColor: 'action.default', outlineOffset: '0.1875rem' };
const disabled = { opacity: 0.45, cursor: 'not-allowed' };
const tones = {
  neutral: { color: 'fg.muted', bg: 'bg.elevated', borderColor: 'border.default' },
  info: { color: 'info.fg', bg: 'info.bg', borderColor: 'info.border' },
  success: { color: 'success.fg', bg: 'success.bg', borderColor: 'success.border' },
  warning: { color: 'warning.fg', bg: 'warning.bg', borderColor: 'warning.border' },
  danger: { color: 'danger.fg', bg: 'danger.bg', borderColor: 'danger.border' },
};

export const theme = {
  tokens: {
    colors: Object.fromEntries(
      Object.entries(palette).map(([name, shades]) => [
        name,
        Object.fromEntries(Object.entries(shades).map(([shade, value]) => [shade, { value }])),
      ]),
    ),
    fonts: {
      body: { value: "'IBM Plex Sans', system-ui, sans-serif" },
      mono: { value: "'IBM Plex Mono', ui-monospace, monospace" },
    },
    spacing: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20].map(n => [n, { value: `${n / 4}rem` }]),
    ),
    radii: {
      xs: { value: '0.125rem' },
      sm: { value: '0.25rem' },
      md: { value: '0.375rem' },
      lg: { value: '0.5rem' },
      pill: { value: '999rem' },
    },
    shadows: {
      none: { value: 'none' },
      sm: { value: '0 1px 2px rgb(0 0 0 / 0.2)' },
      overlay: { value: '0 12px 32px rgb(0 0 0 / 0.35)' },
    },
  },
  semanticTokens: {
    colors: {
      bg: {
        canvas: { value: '{colors.neutral.950}' },
        surface: { value: '{colors.neutral.900}' },
        surfaceSubtle: { value: '{colors.neutral.850}' },
        elevated: { value: '{colors.neutral.800}' },
      },
      fg: {
        default: { value: '{colors.neutral.100}' },
        muted: { value: '{colors.neutral.400}' },
        faint: { value: '{colors.neutral.500}' },
        onAccent: { value: '{colors.neutral.950}' },
      },
      border: {
        default: { value: '{colors.neutral.700}' },
        strong: { value: '{colors.neutral.600}' },
        control: { value: '{colors.neutral.500}' },
      },
      brand: {
        default: { value: '{colors.green.400}' },
        strong: { value: '{colors.green.500}' },
        subtle: { value: '{colors.green.900}' },
        hover: { value: '{colors.green.300}' },
      },
      action: {
        default: { value: '{colors.blue.400}' },
        hover: { value: '{colors.blue.300}' },
        subtle: { value: '{colors.blue.800}' },
      },
      info: {
        fg: { value: '{colors.blue.300}' },
        bg: { value: '{colors.blue.950}' },
        border: { value: '{colors.blue.800}' },
      },
      success: {
        fg: { value: '{colors.green.300}' },
        bg: { value: '{colors.green.900}' },
        border: { value: '{colors.green.700}' },
      },

      // Darker status backgrounds keep the draft's foreground accents readable.
      warning: {
        fg: { value: '{colors.amber.400}' },
        bg: { value: '{colors.amber.950}' },
        border: { value: '{colors.amber.700}' },
      },
      danger: {
        fg: { value: '{colors.red.400}' },
        bg: { value: '{colors.red.950}' },
        hover: { value: '{colors.red.300}' },
        border: { value: '{colors.red.700}' },
      },
      chart: {
        primary: { value: '{colors.green.400}' },
        secondary: { value: '{colors.blue.400}' },
        grid: { value: '{colors.neutral.700}' },
      },
    },
    spacing: {
      page: { mobile: { value: '{spacing.4}' }, desktop: { value: '{spacing.8}' } },
      section: { value: '{spacing.12}' },
      card: { value: '{spacing.5}' },
      field: { value: '{spacing.2}' },
    },
  },
  breakpoints: { tablet: '48rem', desktop: '72rem' },
  textStyles: {
    display: { value: { fontSize: '2.25rem', lineHeight: '2.75rem', fontWeight: 700 } },
    h1: { value: { fontSize: '1.875rem', lineHeight: '2.375rem', fontWeight: 700 } },
    h2: { value: { fontSize: '1.5rem', lineHeight: '2rem', fontWeight: 700 } },
    h3: { value: { fontSize: '1.25rem', lineHeight: '1.75rem', fontWeight: 600 } },
    'body-lg': { value: { fontSize: '1.0625rem', lineHeight: '1.6875rem', fontWeight: 400 } },
    body: { value: { fontSize: '0.9375rem', lineHeight: '1.5rem', fontWeight: 400 } },
    'body-sm': { value: { fontSize: '0.875rem', lineHeight: '1.3125rem', fontWeight: 400 } },
    label: { value: { fontSize: '0.8125rem', lineHeight: '1.125rem', fontWeight: 600 } },
    caption: { value: { fontSize: '0.75rem', lineHeight: '1.0625rem', fontWeight: 400 } },
    eyebrow: {
      value: {
        fontSize: '0.75rem',
        lineHeight: '1.125rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
      },
    },
    'metric-xl': {
      value: {
        fontFamily: 'mono',
        fontSize: '2.25rem',
        lineHeight: '2.5rem',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      },
    },
    metric: {
      value: {
        fontFamily: 'mono',
        fontSize: '1.25rem',
        lineHeight: '1.625rem',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      },
    },
  },
  recipes: {
    button: defineRecipe({
      className: 'academy-button',
      base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2',
        px: '4',
        minHeight: '2.75rem',
        border: '1px solid',
        borderColor: 'transparent',
        borderRadius: 'md',
        textStyle: 'label',
        cursor: 'pointer',
        textDecoration: 'none',
        _focusVisible: focus,
        _disabled: disabled,
      },
      variants: {
        variant: {
          primary: {
            bg: 'brand.default',
            color: 'fg.onAccent',
            _hover: { bg: 'brand.hover' },
            _active: { bg: 'brand.strong' },
          },
          secondary: {
            bg: 'bg.elevated',
            borderColor: 'border.control',
            _hover: { bg: 'bg.surfaceSubtle', borderColor: 'fg.muted' },
            _active: { bg: 'bg.canvas' },
          },
          ghost: {
            color: 'fg.muted',
            _hover: { bg: 'bg.elevated', color: 'fg.default' },
            _active: { bg: 'bg.surfaceSubtle' },
          },
          menu: {
            justifyContent: 'flex-start',
            textAlign: 'left',
            fontWeight: 'normal',
            color: 'fg.muted',
            _hover: { bg: 'bg.elevated', color: 'fg.default' },
            _active: { bg: 'bg.surfaceSubtle' },
          },
          danger: {
            bg: 'danger.fg',
            color: 'fg.onAccent',
            _hover: { bg: 'danger.hover' },
            _active: { bg: 'danger.fg' },
          },
          link: {
            color: 'action.default',
            px: '0',
            _hover: { color: 'action.hover', textDecoration: 'underline' },
            _active: { color: 'action.default' },
          },
        },
        size: { sm: { minHeight: '2.25rem', px: '3' }, md: {} },
      },
      defaultVariants: { variant: 'secondary', size: 'md' },
    }),
    panel: defineRecipe({
      className: 'academy-panel',
      base: {
        minWidth: 0,
        p: 'card',
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 'lg',
        bg: 'bg.surface',
      },
      variants: {
        variant: {
          default: {},
          inset: { bg: 'bg.surfaceSubtle', borderRadius: 'md' },
          interactive: {
            textAlign: 'left',
            cursor: 'pointer',
            _hover: { borderColor: 'border.strong', bg: 'bg.elevated' },
            _focusVisible: focus,
            _active: { bg: 'bg.surfaceSubtle' },
            _selected: { borderColor: 'brand.default', bg: 'brand.subtle' },
            _disabled: disabled,
          },
        },
      },
      defaultVariants: { variant: 'default' },
    }),
    badge: defineRecipe({
      className: 'academy-badge',
      base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1',
        px: '2',
        py: '1',
        border: '1px solid',
        borderRadius: 'pill',
        textStyle: 'caption',
      },
      variants: { tone: tones },
      defaultVariants: { tone: 'neutral' },
    }),
    callout: defineRecipe({
      className: 'academy-callout',
      base: { p: '4', border: '1px solid', borderRadius: 'md', textStyle: 'body-sm' },
      variants: { tone: tones },
      defaultVariants: { tone: 'info' },
    }),
    input: defineRecipe({
      className: 'academy-input',
      base: {
        width: '100%',
        minHeight: '2.75rem',
        px: '3',
        py: '2',
        bg: 'bg.canvas',
        color: 'fg.default',
        border: '1px solid',
        borderColor: 'border.control',
        borderRadius: 'md',
        textStyle: 'body',
        _placeholder: { color: 'fg.muted' },
        _hover: { borderColor: 'fg.muted' },
        _focusVisible: focus,
        _invalid: { borderColor: 'danger.fg' },
        _disabled: disabled,
      },
      variants: {
        kind: {
          select: { appearance: 'none', pr: '10' },
        },
      },
    }),
    tabs: defineRecipe({
      className: 'academy-tabs',
      base: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1',
        borderBottom: '1px solid',
        borderColor: 'border.default',
      },
    }),
    tab: defineRecipe({
      className: 'academy-tab',
      base: {
        px: '4',
        py: '3',
        minHeight: '2.75rem',
        color: 'fg.muted',
        borderBottom: '2px solid transparent',
        textStyle: 'label',
        cursor: 'pointer',
        _hover: { color: 'fg.default', bg: 'bg.elevated' },
        _focusVisible: focus,
        _selected: { color: 'brand.default', borderColor: 'brand.default' },
        _disabled: disabled,
      },
    }),
    tableRow: defineRecipe({
      className: 'academy-table-row',
      base: {
        borderBottom: '1px solid',
        borderColor: 'border.default',
        '& > *': { px: '3', py: '3', textAlign: 'left', textStyle: 'body-sm' },
        _hover: { bg: 'bg.surfaceSubtle' },
      },
    }),
  },
} satisfies NonNullable<Config['theme']>;

export const globalFontface = defineGlobalFontface({
  'IBM Plex Sans': [
    { weight: 400, name: 'Regular' },
    { weight: 600, name: 'SemiBold' },
    { weight: 700, name: 'Bold' },
  ].map(({ weight, name }) => ({
    fontStyle: 'normal',
    fontWeight: weight,
    fontDisplay: 'swap' as const,
    src: `url('/fonts/IBMPlexSans-${name}-Latin1.woff2') format('woff2')`,
  })),
  'IBM Plex Mono': [
    { weight: 400, name: 'Regular' },
    { weight: 600, name: 'SemiBold' },
  ].map(({ weight, name }) => ({
    fontStyle: 'normal',
    fontWeight: weight,
    fontDisplay: 'swap' as const,
    src: `url('/fonts/IBMPlexMono-${name}-Latin1.woff2') format('woff2')`,
  })),
});

export const globalCss = defineGlobalStyles({
  html: {
    fontSize: '100%',
    colorScheme: 'dark',
    bg: 'bg.canvas',
    color: 'fg.default',
    fontFamily: 'body',
    '--global-font-body': 'fonts.body',
    '--global-font-mono': 'fonts.mono',
  },
  body: { textStyle: 'body' },
  'p, h1, h2, h3, h4, h5, h6': { overflowWrap: 'break-word' },
  p: { textWrap: 'pretty' },
  'h1, h2, h3, h4, h5, h6': { textWrap: 'balance' },
  'a, button, input, select, textarea': { _focusVisible: focus },
  'button:disabled': { pointerEvents: 'none' },
  '::selection': { bg: 'brand.subtle', color: 'fg.default' },
});
