import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "var(--background)",
                foreground: "var(--foreground)",
                sim: {
                    accent: {
                        cyan: "#00ffff",
                        blue: "#3b82f6",
                        red: "#ef4444",
                        orange: "#f97316",
                        green: "#22c55e",
                        yellow: "#eab308",
                    },
                    text: {
                        primary: "#e0f2fe",
                        secondary: "#7dd3fc",
                        muted: "#38bdf8",
                        dim: "#0284c7",
                    }
                }
            },
            fontFamily: {
                header: ["Aldrich", "sans-serif"],
                mono: ["Share Tech Mono", "monospace"],
            },
        },
    },
    plugins: [],
};
export default config;
