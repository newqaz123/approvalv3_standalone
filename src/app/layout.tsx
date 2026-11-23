import { SessionProvider } from "next-auth/react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { auth } from "@/lib/auth-config";
import { LanguageSelectionProvider } from "@/components/navigation/language-selector";
import { LocaleProvider } from "@/lib/i18n/client";
import { createTranslator } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
	const t = createTranslator(await getRequestLocale());
	return { title: "ImproveFlow", description: t("app.description") };
}

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const [session, locale] = await Promise.all([auth(), getRequestLocale()]);

	return (
		<html lang={locale}>
			<body className={inter.className}>
				<LocaleProvider locale={locale}>
					<LanguageSelectionProvider>
						<SessionProvider session={session}>
							{children}
							<Toaster />
						</SessionProvider>
					</LanguageSelectionProvider>
				</LocaleProvider>
			</body>
		</html>
	);
}
