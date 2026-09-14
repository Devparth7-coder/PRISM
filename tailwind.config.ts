import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#0a0b0d",
          900: "#0e1013",
          850: "#121418",
          800: "#171a1f",
          750: "#1c2027",
          700: "#23272f",
          600: "#2e333d",
          500: "#3d434f",
          400: "#5a6170",
          300: "#8b93a3",
          200: "#b8bfcc",
          100: "#dde1e8",
          50: "#f4f6f9",
        },
        prism: {
          red: "#ef4444",
          crimson: "#dc2626",
          amber: "#f59e0b",
          green: "#22c55e",
          blue: "#3b82f6",
          violet: "#8b5cf6",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        dash: {
          to: { strokeDashoffset: "-1000" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "pulse-soft": "pulseSoft 1.6s ease-in-out infinite",
        dash: "dash 20s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
