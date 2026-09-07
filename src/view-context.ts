import type { ViewConfig, ViewContext } from "./types";

export function resolveViewContext(view: ViewConfig, context: ViewContext): ViewConfig {
	return context === "note" ? view : { ...view, ...view.contexts?.[context] };
}
