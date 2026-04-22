import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#1c1c1c",
        surface: "#141414",
        deep: "#0f0f0f",
        amber: {
          DEFAULT: "#e8a020",
          dim: "#9a6510",
          border: "#4a3000",
        },
        border: "#2a2a2a",
        primary: "#e0e0e0",
        muted: "#666666",
        faint: "#333333",
        compute: {
          DEFAULT: "#4a9eff",
          bg: "#050d1a",
          line: "#1e4a8a",
        },
        data: {
          DEFAULT: "#3dba68",
          bg: "#050f0a",
          line: "#1a6b35",
        },
        validation: {
          DEFAULT: "#b06aff",
          bg: "#0e0818",
          line: "#5a2e8a",
        },
        virus: {
          DEFAULT: "#c0392b",
          bg: "#1a0000",
          line: "#7a1515",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
