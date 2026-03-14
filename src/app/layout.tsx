import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "ANTARIS | Orbital Simulation",
    description: "Advanced Satellite Tracking and Earth Monitoring Dashboard",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="antialiased" suppressHydrationWarning>
                {children}
            </body>
        </html>
    );
}
