import { describe, expect, it, vi } from "vitest";
import { loadRendererExport } from "./helpers/loadRendererExport";
import { committedDraftValue, parseFiniteDraftNumber } from "../src/renderer/lib/numericDraft";

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
  const document = { activeElement: null as unknown };
  const frames: Array<() => void> = [];
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
    committedDraftValue,
    PM: {},
    PointerDrag: { useController: () => ({ start: () => undefined }) },
    UnitPrefs,
    UI: {},
    document,
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
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
  const onChange = vi.fn();
  const props = { label: "Value", value: 1, unit: "m", imperialUnit: "in", onChange, ...overrides };
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
  return { render, onChange, document, flushFrames: () => frames.splice(0).forEach(callback => callback()), setUnitSystem: (next: string) => { unitSystem = next; } };
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
      committedDraftValue,
      PM: {},
      PointerDrag: { useController: () => ({ start: () => undefined }) },
      UnitPrefs: { current: () => "metric", fromCanonical: (value: unknown) => value, toCanonical: (value: unknown) => value, label: () => "" },
    } },
  );
  const tree = UI.Num({ label: "Value", value: 1, onChange: () => undefined, ...(projectDraft === undefined ? {} : { projectDraft }) });
  return inputIn(tree)!;
}

function robotPageFieldProps(label: string, setRobot: (patch: Record<string, unknown>) => void): Record<string, unknown> {
  const element = (type: unknown, props: Record<string, unknown>, ...children: unknown[]): ElementNode => ({ type, props: props ?? {}, children });
  const React = {
    Fragment: Symbol("Fragment"),
    createElement: element,
    useEffect: () => undefined,
    useId: () => "robot-page",
    useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => [initial, () => undefined],
  };
  const { RobotPage } = loadRendererExport<{ RobotPage: (props: Record<string, unknown>) => ElementNode }>(
    new URL("../src/renderer/components/RobotPage.jsx", import.meta.url),
    "RobotPageControls",
    {
      context: {
        React,
        committedDraftValue,
        PM: { robotHardLimits: () => null },
        PointerDrag: { useController: () => ({ start: () => undefined }) },
        UnitPrefs: { current: () => "metric", fromCanonical: (value: number) => value, toCanonical: (value: number) => value, label: () => "", format: () => "" },
        UI: {},
      },
      replacements: [["export { RobotPage };", "window.RobotPageControls = { RobotPage };"]],
    },
  );
  const tree = RobotPage({
    robot: { drive: "swerve", w: 0.8, l: 0.8, maxSpeed: 4.5 },
    setRobot,
    unitSystem: "metric",
    pushController: { pairing: null, busy: false },
  });
  const field = (node: unknown): ElementNode | undefined => {
    if (Array.isArray(node)) return node.map(field).find(Boolean);
    if (!node || typeof node !== "object") return undefined;
    const element = node as ElementNode;
    return element.props?.label === label ? element : element.children?.map(field).find(Boolean);
  };
  return field(tree)!.props;
}

function commandNumberInput(onChange: (value: number) => void, overrides = {}): ElementNode {
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
    valueType: "I32",
    parameter: { min: 1, max: 9 },
    onChange,
    ...overrides,
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

  it("keeps an invalid number focused on Enter and associates its error", () => {
    const harness = numericDraftHarness("Num");
    let input = harness.render();
    (input.props.onChange as Function)({ target: { value: "bad" } });
    input = harness.render();
    const blur = vi.fn();
    (input.props.onKeyDown as Function)({ key: "Enter", preventDefault() {}, target: { value: "bad", blur } });
    input = harness.render();
    expect(blur).not.toHaveBeenCalled();
    expect(harness.onChange).not.toHaveBeenCalled();
    expect(input.props["aria-invalid"]).toBe(true);
    expect(input.props["aria-describedby"]).toContain("numeric-draft-error");
  });

  it.each(["Num", "BigNum"] as const)("keeps the exact stored value when an untouched imperial %s blurs", (kind) => {
    const harness = numericDraftHarness(kind, { value: 0.007 });
    harness.setUnitSystem("imperial");
    let input = harness.render();
    (input.props.onFocus as Function)({ target: { select: vi.fn() } });
    input = harness.render();
    expect(input.props.value).toBe("0.07");
    (input.props.onBlur as Function)({ target: { value: input.props.value } });
    expect(harness.onChange).not.toHaveBeenCalled();

    input = harness.render();
    (input.props.onChange as Function)({ target: { value: "4" } });
    input = harness.render();
    (input.props.onBlur as Function)({ target: { value: "4" } });
    expect(harness.onChange).toHaveBeenCalledExactlyOnceWith(0.4);
  });

  it("does not enable the physical drive model when an untouched Settings field blurs", () => {
    const setRobot = vi.fn();
    const harness = numericDraftHarness("BigNum", robotPageFieldProps("Drive reduction", setRobot));
    let input = harness.render();
    (input.props.onFocus as Function)({ target: { select: vi.fn() } });
    input = harness.render();
    (input.props.onBlur as Function)({ target: { value: input.props.value } });
    expect(setRobot).not.toHaveBeenCalled();

    input = harness.render();
    (input.props.onChange as Function)({ target: { value: "7" } });
    input = harness.render();
    (input.props.onBlur as Function)({ target: { value: "7" } });
    expect(setRobot).toHaveBeenCalledOnce();
    expect(setRobot.mock.calls[0][0].driveModel).toMatchObject({ gearRatio: 7 });
  });

  it("leaves an unset optional Settings value unset when an empty draft blurs or submits", () => {
    const harness = numericDraftHarness("BigNum", { value: undefined });
    let input = harness.render();
    (input.props.onFocus as Function)({ target: { select: vi.fn() } });
    input = harness.render();
    expect(input.props.value).toBe("");
    (input.props.onBlur as Function)({ target: { value: "" } });
    input = harness.render();
    expect(input.props["aria-invalid"]).toBe(false);

    const blur = vi.fn();
    (input.props.onKeyDown as Function)({ key: "Enter", preventDefault() {}, currentTarget: { value: "", blur } });
    input = harness.render();
    expect(blur).toHaveBeenCalledOnce();
    expect(input.props["aria-invalid"]).toBe(false);
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  it.each(["Num", "BigNum"] as const)("cancels %s with Escape without losing focus or committing on subsequent blur", (kind) => {
    const harness = numericDraftHarness(kind);
    let input = harness.render();
    (input.props.onChange as Function)({ target: { value: "5" } });
    input = harness.render();
    const blur = vi.fn(), stopPropagation = vi.fn();
    (input.props.onKeyDown as Function)({ key: "Escape", preventDefault() {}, stopPropagation, target: { value: "5", blur } });
    input = harness.render();
    expect(input.props.value).toBe("1.00");
    expect(blur).not.toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    (input.props.onBlur as Function)({ target: { value: "1.00" } });
    expect(harness.onChange).not.toHaveBeenCalled();
    (input.props.onChange as Function)({ target: { value: "3" } });
    input = harness.render();
    (input.props.onBlur as Function)({ target: { value: "3" } });
    expect(harness.onChange).toHaveBeenCalledWith(3);
  });

  it.each(["Num", "BigNum"] as const)("does not let deferred %s selection steal focus from a menu", (kind) => {
    const harness = numericDraftHarness(kind);
    const input = harness.render();
    const target = { value: "1", select: vi.fn() };
    const menu = {};
    harness.document.activeElement = target;
    (input.props.onFocus as Function)({ target });
    harness.document.activeElement = menu;
    harness.flushFrames();
    expect(target.select).not.toHaveBeenCalled();
    harness.document.activeElement = target;
    (input.props.onFocus as Function)({ target });
    harness.flushFrames();
    expect(target.select).toHaveBeenCalledOnce();
    target.select.mockClear();
    (input.props.onKeyDown as Function)({ key: "Escape", target, preventDefault() {}, stopPropagation() {} });
    harness.document.activeElement = menu;
    harness.flushFrames();
    expect(target.select).not.toHaveBeenCalled();
  });

  it("commits a valid number only once when Enter triggers blur", () => {
    const harness = numericDraftHarness("Num");
    let input = harness.render();
    (input.props.onFocus as Function)({ target: { select: vi.fn() } });
    input = harness.render();
    (input.props.onChange as Function)({ target: { value: "2" } });
    input = harness.render();
    expect(input.props.value).toBe("2");
    const typed = input;
    const blur = vi.fn(() => (typed.props.onBlur as Function)({ target: { value: "2" } }));
    (input.props.onKeyDown as Function)({ key: "Enter", preventDefault() {}, target: { value: "2", blur } });
    expect(blur).toHaveBeenCalled();
    expect(harness.onChange).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("keeps the exact canonical BigNum value when display units change while it is focused", () => {
    const harness = numericDraftHarness("BigNum", { value: 0.12345 });
    let input = harness.render();
    (input.props.onFocus as Function)({ target: { select: vi.fn() } });
    input = harness.render();
    expect(input.props.value).toBe("0.12345");

    // Enter on the rounded presentation left by the unit change.
    harness.setUnitSystem("imperial");
    input = harness.render();
    expect(input.props.value).toBe("1.23");
    const shown = input;
    const blur = vi.fn(() => (shown.props.onBlur as Function)({ target: { value: "1.23" } }));
    (input.props.onKeyDown as Function)({ key: "Enter", preventDefault() {}, currentTarget: { value: "1.23", blur } });
    expect(blur).toHaveBeenCalledOnce();
    expect(harness.onChange).not.toHaveBeenCalled();

    // Blur on the rounded presentation left by another unit change.
    input = harness.render();
    (input.props.onFocus as Function)({ target: { select: vi.fn() } });
    input = harness.render();
    harness.setUnitSystem("metric");
    input = harness.render();
    expect(input.props.value).toBe("0.12");
    (input.props.onBlur as Function)({ target: { value: "0.12" } });
    input = harness.render();
    expect(input.props["aria-invalid"]).toBe(false);
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  it("commits a BigNum value typed after display units change while it is focused", () => {
    const harness = numericDraftHarness("BigNum", { value: 0.12345 });
    let input = harness.render();
    (input.props.onFocus as Function)({ target: { select: vi.fn() } });
    input = harness.render();
    harness.setUnitSystem("imperial");
    input = harness.render();
    expect(input.props.value).toBe("1.23");

    (input.props.onChange as Function)({ target: { value: "4" } });
    input = harness.render();
    expect(input.props.value).toBe("4");
    const typed = input;
    const blur = vi.fn(() => (typed.props.onBlur as Function)({ target: { value: "4" } }));
    (input.props.onKeyDown as Function)({ key: "Enter", preventDefault() {}, currentTarget: { value: "4", blur } });
    expect(blur).toHaveBeenCalledOnce();
    expect(harness.onChange).toHaveBeenCalledExactlyOnceWith(0.4);
  });

  it("commits the live command value when Save blurs before React rerenders", () => {
    const onChange = vi.fn();
    const input = commandNumberInput(onChange);

    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "7" } });
    (input.props.onBlur as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "7" } });

    expect(onChange).toHaveBeenLastCalledWith(7);
  });
});

 describe("Wait numeric draft range", () => {
  it.each(["", "-", "1e", "NaN", "Infinity", "-2", "0", "0.019", "100"])("preserves the committed duration for invalid %s", (raw) => {
    const changed = vi.fn();
    const control = commandNumberInput(changed, { integer: false, valueType: undefined, parameter: { min: .02, max: 15 } });
    (control.props.onChange as Function)({ target: { value: raw } });
    expect(changed).not.toHaveBeenCalled();
    (control.props.onBlur as Function)({ currentTarget: { value: raw } });
    expect(changed).not.toHaveBeenCalled();
  });
  it.each([.02, 1.25, 15])("commits valid duration %s on blur or Enter", (value) => {
    const changed = vi.fn();
    const control = commandNumberInput(changed, { integer: false, valueType: undefined, parameter: { min: .02, max: 15 } });
    (control.props.onBlur as Function)({ currentTarget: { value: String(value) } });
    expect(changed).toHaveBeenLastCalledWith(value);
    changed.mockClear();
    const blur = vi.fn(() => (control.props.onBlur as Function)({ currentTarget: { value: String(value) } }));
    (control.props.onKeyDown as Function)({ key: 'Enter', preventDefault() {}, stopPropagation() {}, currentTarget: { value: String(value), blur } });
    expect(blur).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledExactlyOnceWith(value);
  });
});
