// Resolves Steam's gamepad-aware <textarea>, so multiline fields can receive
// on-screen keyboard input in Gamepad UI. A plain <textarea> takes DOM focus but
// never receives the virtual keyboard's text: Steam only routes it into inputs
// built by its own element factory (the one @decky/ui's TextField wraps for
// "input"). Its "textarea" sibling is used by Steam but not exported.
// If Steam's internals change and resolution fails, null is returned and the
// caller falls back to a TextField.
//
// Ported from Decky Metadata v0.6.4 (src/steam/gamepadTextArea.ts) by beallio:
//   https://github.com/beallio/Decky-Metadata
// Licensed under the GNU General Public License v3.0 or later. See NOTICE.

import { findModuleExport } from "@decky/ui";
import type { ComponentType, TextareaHTMLAttributes } from "react";

export type GamepadTextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

function resolveGamepadTextArea(): ComponentType<GamepadTextAreaProps> | null {
	try {
		const factory = findModuleExport((moduleExport: unknown) => {
			if (typeof moduleExport !== "function")
				return false;
			const source = String(moduleExport);
			return source.includes("virtualKeyboardProps") &&
				(source.includes("BIsElementValidForInput") || source.includes("forwardRef"));
		});
		if (typeof factory !== "function")
			return null;
		const component = factory("textarea");
		return typeof component === "function" || (component && typeof component === "object")
			? (component as ComponentType<GamepadTextAreaProps>)
			: null;
	}
	catch {
		return null;
	}
}

let cached: ComponentType<GamepadTextAreaProps> | null | undefined;

/** The gamepad textarea component, or null when unavailable (resolved once, lazily) */
export function getGamepadTextArea(): ComponentType<GamepadTextAreaProps> | null {
	if (cached === undefined)
		cached = resolveGamepadTextArea();
	return cached;
}
