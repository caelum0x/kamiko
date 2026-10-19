import { useTranslation } from 'react-i18next';

import { BasicPage } from './common';
import { GitHubLink } from "@/components/githubLink";

export function CommunityPage() {
  const { t } = useTranslation();

  return (
    <BasicPage
      title={t("Community")}
      description={t("community_desc", "Kamiko is built on the open-source Amica project (MIT license). This page used to link Amica's upstream Arbius community channels by default, which is not where $KAMIKO holders should go — removed to avoid sending you to the wrong project's Telegram/Twitter/Discord.")}
    >
      <ul role="list" className="divide-y divide-gray-100 max-w-xs">
        <li className="py-4">
          <GitHubLink />
        </li>
        <li className="py-4">
          <a
            href="https://kamiko.fun"
            target="_blank"
            className="rounded bg-emerald-600 px-2 py-1 text-lg font-semibold text-white shadow-sm hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
            {t("Documentation")}
          </a>
        </li>
      </ul>
    </BasicPage>
  );
}
