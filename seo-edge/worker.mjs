// Minimal edge for the static kamiko.fun export: one canonical origin
// (https://kamiko.fun). www and plain-http requests get a 301; everything
// else is served from the static assets unchanged.
const CANONICAL_HOST = 'kamiko.fun';

export function canonicalRedirect(requestUrl) {
  const url = new URL(requestUrl);
  const isWww = url.hostname === `www.${CANONICAL_HOST}`;
  const isApexHttp = url.hostname === CANONICAL_HOST && url.protocol === 'http:';
  if (!isWww && !isApexHttp) return null;
  url.protocol = 'https:';
  url.hostname = CANONICAL_HOST;
  url.port = '';
  return url.toString();
}

export default {
  async fetch(request, env) {
    const target = canonicalRedirect(request.url);
    return target ? Response.redirect(target, 301) : env.ASSETS.fetch(request);
  },
};
