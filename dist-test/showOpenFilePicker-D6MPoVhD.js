//#region ../../projects/dom.ts/src/polyfill/showOpenFilePicker.mjs
var { showOpenFilePicker: e, showSaveFilePicker: t } = globalThis.showOpenFilePicker ?? typeof document == "object" ? (() => {
	let e = /* @__PURE__ */ new WeakMap(), t = FileSystemHandle.prototype, n = FileSystemFileHandle.prototype;
	document.createElement("a");
	let r = (t) => {
		let n = { async getFile() {
			return t;
		} };
		return e.set(n, t), n;
	}, i = (e) => c(Object(e?.accept)).join(","), { create: a, defineProperties: o, getOwnPropertyDescriptors: s, values: c } = Object, { name: l, kind: u, ...d } = s(t), { getFile: f, ...p } = s(n);
	return WritableStream, {
		showOpenFilePicker(e = null) {
			let t = document.createElement("input");
			t.type = "file", t.multiple = !!e?.multiple, t.accept = [].concat(e?.types ?? []).map(i).join(",");
			let n = new Promise((e, n) => {
				t.addEventListener("change", () => {
					e([...t.files].map(r)), t.value = null, t.files = null;
				}, { once: !0 }), t.addEventListener("cancel", () => {
					n(new DOMException("The user aborted a request."));
				}, { once: !0 });
			});
			return t.click(), n;
		},
		async showSaveFilePicker(e = null) {
			let t = [].concat(Object.entries(Object([].concat(e?.types ?? [])[0]?.accept)))[0] || ["text/plain", [".txt"]];
			return r(new File([], e?.suggestedName ?? "Untitled" + (t?.[1]?.[0] || ".txt"), { type: t?.[0] || "text/plain" }));
		}
	};
})() : {
	async showOpenFilePicker() {
		return [];
	},
	async showSaveFilePicker() {
		return [];
	}
};
//#endregion
export { e as showOpenFilePicker, t as showSaveFilePicker };
