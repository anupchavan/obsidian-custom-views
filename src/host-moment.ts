import { moment as hostMoment } from "obsidian";
import type MomentFactory from "moment";

// Obsidian exposes the callable Moment factory; its namespace declaration loses
// the call signature when a consumer enables esModuleInterop.
export const moment = hostMoment as unknown as typeof MomentFactory;
export type { Moment, unitOfTime } from "moment";
