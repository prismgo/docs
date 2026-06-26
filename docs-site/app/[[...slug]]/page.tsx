import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export async function generateStaticParams() {
  const params = source.generateParams();
  const hasRoot = params.some(
    (p: { slug?: string[] }) => !p.slug || p.slug.length === 0,
  );
  if (!hasRoot) {
    params.unshift({ slug: [], lang: i18n.defaultLanguage });
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!slug || slug.length === 0) {
    const defaultPage = source.getPage([i18n.defaultLanguage, 'starter']);
    if (defaultPage) {
      return {
        title: `${defaultPage.data.title} | PrismGo Docs`,
        description: defaultPage.data.description,
      };
    }
    return { title: 'PrismGo Docs' };
  }
  const page = source.getPage(slug);
  if (!page) notFound();

  return {
    title: `${page.data.title} | PrismGo Docs`,
    description: page.data.description,
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;

  // For static export: render default locale's starter page directly at root
  const resolvedSlug = !slug || slug.length === 0
    ? [i18n.defaultLanguage, 'starter']
    : slug;

  const page = source.getPage(resolvedSlug);
  if (!page) notFound();

  const MDX = page.data.body;

  return <MDX />;
}
