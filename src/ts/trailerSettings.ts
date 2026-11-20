// Settings of the game trailers (trailers.ts), apart so that the settings can load without the trailers' imports

export type TrailerSettings = {
	enabled: boolean;
	audio: boolean;
	delay: number; // Seconds from opening a game's page to showing its trailer
	hide_logo: boolean;
};

export const defaultTrailerSettings: TrailerSettings = {
	enabled: false,
	audio: false,
	delay: 3,
	hide_logo: false
};
