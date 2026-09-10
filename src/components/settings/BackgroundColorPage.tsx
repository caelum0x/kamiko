import { useTranslation } from 'react-i18next';

import { BasicPage, FormRow, ResetToDefaultButton } from './common';
import { TextInput } from '@/components/textInput';
import { SwitchBox } from '@/components/switchBox';
import { applyBackground, resolveBackground, INK } from "@/features/stage/background";
import { config, updateConfig, defaultConfig } from "@/utils/config";

export function BackgroundColorPage({
  bgColor,
  setBgColor,
  setSettingsUpdated,
}: {
  bgColor: string;
  setBgColor: (color: string) => void;
  setSettingsUpdated: (updated: boolean) => void;
}) {
  const { t } = useTranslation();

  /*
   * `bg_color` now DEFAULTS TO EMPTY — that is what makes the bundled backgrounds reachable (see
   * features/stage/background.ts). `<input type="color">` cannot hold an empty value: React logs a
   * warning and the browser silently substitutes #000000, so the swatch would claim she is on black
   * while she is standing in the room. The picker shows ink as the colour it would apply, and the
   * "no background color set" line above says which of the two is actually live.
   */
  const swatch = bgColor === '' ? INK : bgColor;

  return (
    <BasicPage
      title={t("Background Color")}
      description={t("bg_color_desc", "Configure the background color. This overrides background image.")}
    >
      <ul role="list" className="divide-y divide-gray-100 max-w-xs">
        <li className="py-4">
          {bgColor === '' && (
            <p className="text-xs text-gray-500">{t("no_bg_color", "No background color set. Click the box below.")}</p>
          )}
          <FormRow label={t("Color")}>
            <div className="flex items-center">
              <input
                className={"block bg-white border-0 outline-none focus:ring-0 focus:border-gray-300 rounded-md shadow-sm w-20"}
                type="color"
                value={swatch}
                onChange={(event: React.ChangeEvent<any>) => {
                  applyBackground({ kind: 'color', color: event.target.value }, document.body);
                  updateConfig("youtube_videoid", "");
                  updateConfig("bg_url", "");
                  updateConfig("bg_color", event.target.value);
                  setBgColor(event.target.value);
                  setSettingsUpdated(true);
                }}
              />

              <SwitchBox
                value={bgColor === 'transparent'}
                label="Transparent"
                onChange={(value: boolean) => {
                  // Leaving "transparent" has to land on a REAL colour: config("bg_color") is
                  // 'transparent' at that moment, so the old code turned the switch off and left
                  // the page transparent forever.
                  const next = value ? 'transparent' : INK;
                  applyBackground({ kind: 'color', color: next }, document.body);
                  updateConfig("youtube_videoid", "");
                  updateConfig("bg_url", "");
                  updateConfig("bg_color", next);

                  setBgColor(next);
                  setSettingsUpdated(true);
                }}
              />
            </div>

            { bgColor !== defaultConfig("bg_color") && (
              <p className="mt-2">
                <ResetToDefaultButton onClick={() => {
                  // The default is now "no colour", i.e. hand the stage back to the background
                  // image — which is exactly what resetting a colour ought to mean.
                  updateConfig("bg_color", defaultConfig("bg_color"));
                  applyBackground(
                    resolveBackground(defaultConfig("bg_color"), config("bg_url")),
                    document.body,
                  );
                  setBgColor(defaultConfig("bg_color"));
                  setSettingsUpdated(true);
                  }}
                />
              </p>
            )}
          </FormRow>
        </li>
      </ul>
    </BasicPage>
  );
}
