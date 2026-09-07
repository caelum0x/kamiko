import { XMarkIcon } from '@heroicons/react/20/solid';
import { useState, useCallback } from "react";
import { updateConfig } from "@/utils/config";
import { useTranslation, Trans } from 'react-i18next';

export const Introduction = ({ open }: {
  open: boolean;
}) => {
  const [opened, setOpened] = useState(open);
  const { t } = useTranslation();

  if (! opened) {
    return null;
  }

  return (
    <div className="absolute z-40 h-full w-full bg-black/30 mx-auto sm:px-24 lg:px-32 font-M_PLUS_2"
    >
      <div className="mx-auto max-h-full overflow-auto rounded-lg bg-white/40 p-4 backdrop-blur-lg shadow-lg">
        <div className="my-4">
          <div className="my-8 font-bold text-xl">
            {t("Welcome to $KAMIKO")}
          </div>
          <p>{t("amica_intro", `
            $KAMIKO is a real-time VTuber character: a 3D avatar with emotion, motion, voice, and vision, rendered live in your browser.

            The stage runs client-side — the character loads and animates without any account or key. Her full AI conversation and on-chain tipping open at launch.
          `)}
          </p>
        </div>
        <div className="my-4">
          <div className="my-8 font-bold typography-20">
            {t("Setup")}
          </div>
          <p>{t('amica_setup', `
            Click on the top left of the screen to open settings.
            
            You can change the voice, character system prompt, share/load/save and attach to different backends or in-browser models. 
            
            Please check our docs for more detailed configuration instructions on docs.heyamica.com
          `)}
          {' '}
          <a href="https://docs.heyamica.com" target="_blank" className="text-cyan-500">{t("Read the full documentation here.")}</a>
          </p>
        </div>

        <div className="my-8 flex space-x-4">
          <button
            onClick={() => {
              updateConfig("show_introduction", "false");
              setOpened(false);
            }}
            className="inline-flex items-center rounded-md bg-secondary px-2.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-secondary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
          >
            {t("dont_show_again", "Don't show again")}
          </button>
          <button
            onClick={() => {
              setOpened(false);
            }}
            className="ml-3 inline-flex items-center rounded-md bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
};
