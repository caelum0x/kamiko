import Head from 'next/head';

const SITE_URL = 'https://kamiko.fun';
const SOCIAL_IMAGE = `${SITE_URL}/ogp.png`;
const SOCIAL_IMAGE_ALT =
  '$KAMIKO — the AI girl who woke up inside NVIDIA, a live 3D AI VTuber paired with NVDAx';
// TODO(kamiko): No official $KAMIKO project X/Twitter handle exists in the repo
// as of 2026-09-14 (the README badges point to the upstream Arbius/airi accounts,
// not to Kamiko). Set this to the real handle (e.g. '@kamiko') once the account
// is created so twitter:site / twitter:creator card attribution works. Left empty
// on purpose — do NOT invent a handle. When empty, those tags are omitted rather
// than shipping a fake attribution.
const TWITTER_HANDLE = '';
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
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={SOCIAL_IMAGE_ALT} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="$KAMIKO" />
      <meta name="twitter:card" content="summary_large_image" />
      {TWITTER_HANDLE ? (
        <>
          <meta name="twitter:site" content={TWITTER_HANDLE} />
          <meta name="twitter:creator" content={TWITTER_HANDLE} />
        </>
      ) : null}
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={SOCIAL_IMAGE} />
      <meta name="twitter:image:alt" content={SOCIAL_IMAGE_ALT} />
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}
    </Head>
  );
}
