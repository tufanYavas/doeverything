import type { Config } from 'tailwindcss';

/**
 * doeverything Tailwind preset.
 *
 * All semantic colors map to HSL CSS variables defined in
 * `@doeverything/ui/global.css`. Page-level configs extend this preset so a
 * single source of truth controls the design tokens.
 *
 * `tailwindcss-animate` adds the radix/shadcn-style `data-[state=…]`
 * transitions our primitives rely on. The plugin import is left as a string
 * to avoid a hard dep when the package is not yet installed.
 */
export default {
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1280px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Hanken Grotesk Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // Warm layered elevation — tint comes from the per-theme --shadow token.
        soft: '0 1px 2px hsl(var(--shadow) / 0.05), 0 4px 16px -4px hsl(var(--shadow) / 0.08)',
        lifted: '0 2px 6px hsl(var(--shadow) / 0.08), 0 16px 40px -12px hsl(var(--shadow) / 0.25)',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-bottom': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in-bottom': 'slide-in-bottom 0.3s ease-out',
      },
    },
  },
  plugins: [
    // Loaded lazily so the preset still type-checks before pnpm install runs.

    (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('tailwindcss-animate');
      } catch {
        return () => undefined;
      }
    })(),
  ],
} as Omit<Config, 'content'>;
