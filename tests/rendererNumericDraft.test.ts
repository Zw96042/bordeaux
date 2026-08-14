import { describe, expect, it, vi } from "vitest";
import { loadRendererExport } from "./helpers/loadRendererExport";
import { parseFiniteDraftNumber } from "../src/renderer/lib/numericDraft";

type ElementNode = { type: unknown; props: Record<string, unknown>; children: unknown[] };

function inputIn(node: unknown): ElementNode | undefined {
  if (!node || typeof node !== "object") return undefined;
  const element = node as ElementNode;
  return element.type === "input" ? element : element.children?.map(inputIn).find(Boolean);
}

function numericDraftHarness(kind: "Num" | "BigNum", overrides: Record<string, unknown> = {}) {
  const element = (type: unknown, props: Record<string, unknown>, ...children: unknown[]): ElementNode => ({ type, props: props ?? {}, children });
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effectDependencies: unknown[][] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  let pendingEffects: Array<() => void> = [];
  let unitSystem = "metric";
  const React = {
    createElement: element,
    useEffect: (effect: () => void, dependencies: unknown[]) => {
      const index = effectIndex++;
      const previous = effectDependencies[index];
      effectDependencies[index] = dependencies;
      if (!previous || dependencies.some((dependency, dependencyIndex) => dependency !== previous[dependencyIndex])) pendingEffects.push(effect);
    },
    useId: () => "numeric-draft",
    useRef: (current: unknown) => {
      const index = refIndex++;
      refs[index] ??= { current };
      return refs[index];
    },
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (current: unknown) => unknown)(states[index]) : next; }];
    },
  };
  const UnitPrefs = {
    current: () => unitSystem,
    fromCanonical: (value: number) => unitSystem === "imperial" ? value * 10 : value,
    toCanonical: (value: number) => unitSystem === "imperial" ? value / 10 : value,
    label: () => unitSystem,
  };
  const context = {
    React,
    parseFiniteDraftNumber,
    PM: {},
    PointerDrag: { useController: () => ({ start: () => undefined }) },
    UnitPrefs,
    UI: {},
    requestAnimationFrame: (callback: () => void) => callback(),
  };
  const component = kind === "Num"
    ? loadRendererExport<{ Num: (props: Record<string, unknown>) => ElementNode }>(
        new URL("../src/renderer/components/ui.jsx", import.meta.url),
        "UI",
        { context: { ...context, createPortal: () => null } },
      ).Num
    : loadRendererExport<{ BigNum: (props: Record<string, unknown>) => ElementNode }>(
        new URL("../src/renderer/components/RobotPage.jsx", import.meta.url),
        "RobotPageControls",
        { context, replacements: [["export { RobotPage };", "window.RobotPageControls = { BigNum };"]] },
      ).BigNum;
  const props = { label: "Value", value: 1, unit: "m", imperialUnit: "in", onChange: () => undefined, ...overrides };
  const render = () => {
    let tree: ElementNode;
    for (let pass = 0; pass < 2; pass += 1) {
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
      pendingEffects = [];
      tree = component(props);
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    }
    return inputIn(tree!)!;
  };
  return { render, setUnitSystem: (next: string) => { unitSystem = next; } };
}

function numInput(projectDraft?: boolean): ElementNode {
  const element = (type: unknown, props: Record<string, unknown>, ...children: unknown[]): ElementNode => ({ type, props: props ?? {}, children });
  const React = {
    createElement: element,
    useEffect: () => undefined,
    useId: () => "numeric-draft",
    useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => [initial, () => undefined],
  };
  const UI = loadRendererExport<{ Num: (props: Record<string, unknown>) => ElementNode }>(
    new URL("../src/renderer/components/ui.jsx", import.meta.url),
    "UI",
    { context: {
      React,
      createPortal: () => null,
      parseFiniteDraftNumber,
      PM: {},
      PointerDrag: { useController: () => ({ start: () => undefined }) },
      UnitPrefs: { current: () => "metric", fromCanonical: (value: unknown) => value, toCanonical: (value: unknown) => value, label: () => "" },
    } },
  );
  const tree = UI.Num({ label: "Value", value: 1, onChange: () => undefined, ...(projectDraft === undefined ? {} : { projectDraft }) });
  return inputIn(tree)!;
}

function commandNumberInput(onChange: (value: number) => void): ElementNode {
  const element = (type: unknown, props: Record<string, unknown>, ...children: unknown[]): ElementNode => ({ type, props: props ?? {}, children });
  const React = {
    Fragment: Symbol("Fragment"),
    createElement: element,
    useEffect: () => undefined,
    useState: (initial: unknown) => [initial, () => undefined],
  };
  const ContextDraftEditors = loadRendererExport<{ NumberValueEditor: (props: Record<string, unknown>) => ElementNode }>(
    new URL("../src/renderer/components/ContextInspector.jsx", import.meta.url),
    "ContextDraftEditors",
    {
      context: { React, AUTO: {}, PM: {}, UnitPrefs: {}, UI: {}, FIELD_DIMS: { FIELD_W: 17.548, FIELD_H: 8.052 } },
      replacements: [[
        "export { ContextInspector, CommandParameterEditor, commandArguments, parameterValueError, safeControlId };",
        "window.ContextDraftEditors = { NumberValueEditor };",
      ]],
    },
  );
  return inputIn(ContextDraftEditors.NumberValueEditor({
    id: "command-count",
    label: "Count",
    value: 2,
    integer: true,
    javaType: "int",
    parameter: { min: 1, max: 9 },
    onChange,
  }))!;
}

describe("renderer numeric drafts", () => {
  it.each(["", "   ", "not-a-number"])("rejects an invalid numeric draft %#", (raw) => {
    expect(parseFiniteDraftNumber(raw)).toBeNull();
  });

  it("accepts zero and other finite numeric drafts", () => {
    expect(parseFiniteDraftNumber("0")).toBe(0);
    expect(parseFiniteDraftNumber(" 1.25 ")).toBe(1.25);
  });

  it("marks project-backed numbers for persistence but leaves staged numbers pending", () => {
    expect(numInput().props["data-project-draft"]).toBe(true);
    expect(numInput(false).props["data-project-draft"]).toBeUndefined();
  });

  it.each(["Num", "BigNum"] as const)("clears %s validation when display units change", (kind) => {
    const harness = numericDraftHarness(kind);
    let input = harness.render();
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "bad" } });
    input = harness.render();
    (input.props.onBlur as (event: { target: { value: string } }) => void)({ target: { value: "bad" } });
    input = harness.render();
    expect(input.props["aria-invalid"]).toBe(true);

    harness.setUnitSystem("imperial");
    input = harness.render();

    expect(input.props["aria-invalid"]).toBe(false);
    expect(input.props.value).toBe("10.00");
  });

  it("keeps an optional BigNum blank when it receives focus", () => {
    const harness = numericDraftHarness("BigNum", { value: undefined, placeholder: "Add" });
    let input = harness.render();
    expect(input.props.value).toBe("");
    expect(input.props.placeholder).toBe("Add");

    (input.props.onFocus as (event: { target: { select: () => void } }) => void)({ target: { select: () => undefined } });
    input = harness.render();

    expect(input.props.value).toBe("");
  });

  it("commits the live command value when Save blurs before React rerenders", () => {
    const onChange = vi.fn();
    const input = commandNumberInput(onChange);

    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "7" } });
    (input.props.onBlur as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "7" } });

    expect(onChange).toHaveBeenLastCalledWith(7);
  });
});
