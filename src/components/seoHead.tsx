import Head from 'next/head';

const SITE_URL = 'https://kamiko.fun';
const SOCIAL_IMAGE = `${SITE_URL}/ogp.png`;
const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();

interface SeoHeadProps {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  websiteSchema?: boolean;
  faq?: ReadonlyArray<{ question: string; answer: string }>;
}

export function SeoHead({
  title,
  description,
  path,
  noindex = false,
  websiteSchema = false,
  faq = [],
}: SeoHeadProps) {
  const canonical = new URL(path, SITE_URL).toString();
  const graph: Record<string, unknown>[] = [];

  if (websiteSchema) {
    graph.push(
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: '$KAMIKO',
        alternateName: 'Kamiko',
        url: `${SITE_URL}/`,
        logo: SOCIAL_IMAGE,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: '$KAMIKO',
        alternateName: 'Kamiko',
        url: `${SITE_URL}/`,
        description,
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: 'Kamiko AI VTuber',
        url: `${SITE_URL}/`,
        description,
        applicationCategory: 'EntertainmentApplication',
        operatingSystem: 'Web browser',
        isAccessibleForFree: true,
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
    );
  }

  if (faq.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: faq.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    });
  }

  const structuredData = graph.length > 0
    ? { '@context': 'https://schema.org', '@graph': graph }
    : null;

  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      {GOOGLE_SITE_VERIFICATION ? (
        <meta name="google-site-verification" content={GOOGLE_SITE_VERIFICATION} />
      ) : null}
      <link rel="canonical" href={canonical} />
      {noindex ? <meta name="robots" content="noindex,follow" /> : null}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={SOCIAL_IMAGE} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="$KAMIKO" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={SOCIAL_IMAGE} />
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}
    </Head>
  );
}
