import { FC, useState } from "react";
import { DialogBody, DialogControlsSection, SliderField, ToggleField } from "@decky/ui";
import { useMetaDeckState } from "./MetaDeckState";
import { t } from "./useTranslations";
import { defaultTrailerSettings, type TrailerSettings } from "./trailerSettings";
import { onTrailerSettingsChange } from "./trailers";

/** The "Trailers" page of the settings */
export const TrailerSettingsComponent: FC = () => {
	const { settings } = useMetaDeckState();
	const [values, setValues] = useState<TrailerSettings>({ ...defaultTrailerSettings, ...settings.config.trailers });

	const change = (changes: Partial<TrailerSettings>) => {
		const next = { ...values, ...changes };
		setValues(next);
		settings.config.trailers = next;
		void settings.writeConfig();
		onTrailerSettingsChange();
	};

	return <DialogBody>
		<DialogControlsSection>
			<ToggleField
				label={t("trailersEnabled")}
				description={t("trailersEnabledDesc")}
				checked={values.enabled}
				onChange={(enabled) => change({ enabled })}/>
			<SliderField
				label={t("trailersDelay")}
				description={t("trailersDelayDesc")}
				value={values.delay}
				min={0}
				max={10}
				step={1}
				showValue
				valueSuffix=" s"
				disabled={!values.enabled}
				onChange={(delay) => change({ delay })}/>
			<ToggleField
				label={t("trailersAudio")}
				description={t("trailersAudioDesc")}
				checked={values.audio}
				disabled={!values.enabled}
				onChange={(audio) => change({ audio })}/>
			<ToggleField
				label={t("trailersHideLogo")}
				description={t("trailersHideLogoDesc")}
				checked={values.hide_logo}
				disabled={!values.enabled}
				onChange={(hide_logo) => change({ hide_logo })}/>
		</DialogControlsSection>
	</DialogBody>;
};
