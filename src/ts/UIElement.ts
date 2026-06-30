import { preloadStyle, loadAsAdopted } from "fest/dom";
import { defineElement, GLitElement, H, property } from "fest/lure";
import { ensureStyleSheet } from "fest/icon";

// @ts-ignore
@defineElement("ui-element")
export class UIElement extends GLitElement() {
    @property({ source: "attr" }) theme: string = "default";

    //
    render = function () { return H`<slot></slot>`; }

    //
    constructor() { super(); }

    //
    onRender(): this|void|undefined {
        return super.onRender();
    }

    //
    connectedCallback(): this {
        const result = super.connectedCallback?.();
        const self : any = result ?? this;
        return self;
    }

    //
    onInitialize(): this {
        const result = super.onInitialize();
        // Only load icon styles, not the heavy veela runtime styles
        // which cause freezing/hanging performance issues
        const self : any = result ?? this;
        self.loadStyleLibrary(ensureStyleSheet());
        return self;
    }
}

//
export default UIElement;
