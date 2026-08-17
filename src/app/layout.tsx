import { SessionProvider } from "next-auth/react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { auth } from "@/lib/auth-config";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	title: "ImproveFlow",
	description: "Submit, review, and approve improvements",
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const session = await auth();

	return (
		<html lang="en">
			<body className={inter.className}>
				<SessionProvider session={session}>
					{children}
					<Toaster />
				</SessionProvider>
			</body>
		</html>
	);
}
