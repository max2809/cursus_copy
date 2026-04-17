import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#faf9f7",
        oat: {
          DEFAULT: "#dad4c8",
          light: "#eee9df",
        },
        cool: {
          border: "#e6e8ec",
          frost: "#eff1f3",
        },
        matcha: {
          300: "#84e7a5",
          600: "#078a52",
          800: "#02492a",
        },
        slushie: {
          500: "#3bd3fd",
          800: "#0089ad",
        },
        lemon: {
          400: "#f8cc65",
          500: "#fbbd41",
          700: "#d08a11",
          800: "#9d6a09",
        },
        ube: {
          300: "#c1b0ff",
          800: "#43089f",
          900: "#32037d",
        },
        pomegranate: {
          400: "#fc7981",
        },
        blueberry: {
          800: "#01418d",
        },
        warmsilver: "#9f9b93",
        warmcharcoal: "#55534e",
        darkcharcoal: "#333333",
        badge: {
          bg: "#f0f8ff",
          text: "#3859f9",
        },
      },
      fontFamily: {
        sans: ['"Geist"', "Arial", "sans-serif"],
        mono: ['"Space Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-hero": ["5rem", { lineHeight: "1", letterSpacing: "-0.04em", fontWeight: "600" }],
        "display-2": ["3.75rem", { lineHeight: "1", letterSpacing: "-0.032em", fontWeight: "600" }],
        section: ["2.75rem", { lineHeight: "1.1", letterSpacing: "-0.024em", fontWeight: "600" }],
        card: ["2rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" }],
        feature: ["1.25rem", { lineHeight: "1.4", letterSpacing: "-0.02em", fontWeight: "600" }],
        body: ["1.125rem", { lineHeight: "1.6", letterSpacing: "-0.02em" }],
        label: ["0.75rem", { lineHeight: "1.2", letterSpacing: "0.09em", fontWeight: "600" }],
      },
      borderRadius: {
        sharp: "4px",
        card: "12px",
        feature: "24px",
        section: "40px",
        pill: "9999px",
      },
      boxShadow: {
        clay: "0 1px 1px rgba(0,0,0,0.1), inset 0 -1px 1px rgba(0,0,0,0.04), 0 -0.5px 1px rgba(0,0,0,0.05)",
        "clay-hover": "-7px 7px 0 rgb(0,0,0)",
      },
      transitionTimingFunction: {
        clay: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
