import { useEffect, useState } from "react";
import { buildUrl } from "@/utils/buildUrl";
import { Html, Head, Main, NextScript } from "next/document";
import { GoogleAnalytics } from '@next/third-parties/google';
import Script from 'next/script'

export default function Document() {
  const title = "$KAMIKO — the AI girl who woke up inside NVIDIA. paired with NVDAx.";
  const description = "Kamiko is a live 3D anime-girl AI VTuber reacting to NVIDIA (NVDAx) + her token in real time — emotion, motion, voice, and vision rendered right in your browser. Tap to wake her. Not launched yet — no official contract exists.";
  const imageUrl = "/ogp.png";
  const appName = "$KAMIKO";
  const siteUrl = "https://kamiko.fun";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: appName,
    url: siteUrl,
    description: title,
  };

  return (
    <Html lang="en">
      <Head>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={imageUrl} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={imageUrl} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5" />
        <meta name="apple-mobile-web-app-title" content={appName} />
        <meta name="application-name" content={appName} />
        <meta name="msapplication-TileColor" content="#da532c" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=M+PLUS+2&family=Montserrat&display=swap"
          rel="stylesheet"
        />
        <Script
          src="/debugLogger.js"
          strategy="beforeInteractive"
        />
        <Script
          src="/ammo.wasm.js"
          strategy="beforeInteractive"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
      {process.env.NODE_ENV === "production" && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID!} />
      )}
    </Html>
  );
}
