import { ItemView, type Plugin, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

const TYPE = "custom-views-editor-code";
interface Session { name: string; attach(host: HTMLElement): void; detach(): void }
const sessions = new Map<string, Session>();

/** Native popout leaf; the originating editor remains the owner of the code state. */
class CodePopout extends ItemView {
	private session?: Session;
	private id = "";
	getViewType() { return TYPE; }
	getDisplayText() { return this.session ? `Code · ${this.session.name}` : "View code"; }
	getIcon() { return "code-xml"; }
	getState() { return { sessionId: this.id }; }
	async setState(state: { sessionId?: string }, result: ViewStateResult) {
		this.id = state.sessionId ?? "";
		this.session = sessions.get(this.id);
		if (this.session) this.session.attach(this.contentEl);
		else this.contentEl.setText("Reopen the view editor to edit this template.");
		await super.setState(state, result);
	}
	async onClose() { sessions.delete(this.id); this.session?.detach(); this.session = undefined; }
}
export function registerCodePopout(plugin: Plugin) {
	plugin.registerView(TYPE, leaf => new CodePopout(leaf));
}
export async function openCodePopout(plugin: Plugin, session: Session): Promise<() => void> {
	const id = crypto.randomUUID();
	sessions.set(id,session);
	let leaf: WorkspaceLeaf | undefined;
	try {
		leaf = plugin.app.workspace.openPopoutLeaf();
		await leaf.setViewState({ type:TYPE,active:true,state:{sessionId:id} });
		await plugin.app.workspace.revealLeaf(leaf);
	} catch(error) { sessions.delete(id); leaf?.detach(); throw error; }
	return () => { sessions.delete(id); leaf?.detach(); };
}
