declare module "*.wasm" {
	const wasm: BufferSource | WebAssembly.Module;
	export default wasm;
}

declare module "@silentvoid13/rusty_engine/rusty_engine.js" {
	export * from "@silentvoid13/rusty_engine";
	export { default } from "@silentvoid13/rusty_engine";
}
