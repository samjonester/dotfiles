/**
 * Link Picker Extension
 *
 * Scans conversation messages for URLs and presents them in a searchable
 * overlay. Solves the problem of terminal URL wrapping breaking click targets.
 *
 * Usage:
 * - /links       - Open link picker
 * - Ctrl+Shift+L - Open link picker (shortcut)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { type CollectOptions, collectLinks, friendlyLabel, openUrl } from "./helpers.js";

async function showLinkPicker(ctx: ExtensionContext, options?: CollectOptions): Promise<void> {
	const links = collectLinks(ctx.sessionManager.getBranch() as any[], options);

	if (links.length === 0) {
		ctx.ui.notify("No links found in conversation", "warning");
		return;
	}

	const items: SelectItem[] = links.map(({ url, label }) => ({
		value: url,
		label: friendlyLabel(url, label),
		description: url,
	}));

	const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(" Links ")) + theme.fg("dim", `(${items.length})`),
				1,
				0,
			),
		);

		const selectList = new SelectList(items, Math.min(items.length, 14), {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("dim", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		});
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);

		container.addChild(
			new Text(
				theme.fg("dim", "↑↓ navigate  type to filter  enter open  esc cancel"),
				1,
				0,
			),
		);
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});

	if (result) {
		const err = await openUrl(result);
		if (err) {
			ctx.ui.notify(`Failed to open: ${err}`, "error");
		} else {
			ctx.ui.notify(`Opened: ${result}`, "info");
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("links", {
		description: "Browse and open links from the conversation (/links for last message, /links all for entire session)",
		handler: async (args, ctx) => {
			const all = args?.trim().toLowerCase() === "all";
			await showLinkPicker(ctx, { lastMessageOnly: !all });
		},
	});

	pi.registerShortcut(Key.ctrlShift("l"), {
		description: "Open link picker (last message)",
		handler: async (ctx) => {
			await showLinkPicker(ctx, { lastMessageOnly: true });
		},
	});
}
