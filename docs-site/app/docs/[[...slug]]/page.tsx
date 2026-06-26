import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

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
    return {
      title: 'PrismGo Docs',
    };
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

  // Redirect root /docs to the default locale's default page
  if (!slug || slug.length === 0) {
    redirect(`/docs/${i18n.defaultLanguage}/starter`);
  }

  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return <MDX />;
}