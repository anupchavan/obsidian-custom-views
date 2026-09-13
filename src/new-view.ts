import { nanoid } from "nanoid";
import type { FilterGroup, ViewConfig } from "./types";

export const DEFAULT_RULES: FilterGroup = { type: "group", operator: "AND", conditions: [] };
export function createView(name = "New View"): ViewConfig {
 return { id: nanoid(), name, rules: structuredClone(DEFAULT_RULES), template: "<h1>{{file.basename}}</h1>\n{{file.content}}" };
}
