import { RootProvider } from 'fumadocs-ui/provider';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://prismgo.github.io'),
  title: 'PrismGo Documentation',
  description: 'PrismGo - Comprehensive documentation',
  icons: {
    icon: '/docs/favicon.ico',
    apple: '/docs/logo.png',
  },
  openGraph: {
    title: 'PrismGo Documentation',
    description: 'PrismGo - Comprehensive documentation',
    images: '/docs/logo.png',
  },
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}