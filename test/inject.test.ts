import test from "node:test";
import assert from "node:assert/strict";
import { mergeExplorerInject, type ExplorerInjectApi } from "../src/inject.js";

test("mergeExplorerInject returns undefined when nothing passed", () => {
    assert.equal(mergeExplorerInject(), undefined);
});

test("context-action handlers: later layer overrides same key", async () => {
    let trace = "";
    const low: ExplorerInjectApi = {
        contextActionHandlers: {
            demo: () => {
                trace += "a";
            }
        }
    };
    const high: ExplorerInjectApi = {
        contextActionHandlers: {
            demo: () => {
                trace += "b";
            }
        }
    };
    const merged = mergeExplorerInject(low, high);
    await merged?.contextActionHandlers?.demo?.();
    assert.equal(trace, "b");
});

test("extraBackgroundMenuItems concat in registration order", () => {
    const merged = mergeExplorerInject(
        {
            extraBackgroundMenuItems: () => [{ id: "a", label: "A", action: () => {} }]
        },
        {
            extraBackgroundMenuItems: () => [{ id: "b", label: "B", action: () => {} }]
        }
    );
    const items = merged?.extraBackgroundMenuItems?.({ path: "/tmp/" }) ?? [];
    assert.equal(items.length, 2);
    assert.equal(items[0]?.id, "a");
    assert.equal(items[1]?.id, "b");
});
