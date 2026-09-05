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

  it("commits the live command value when Save blurs before React rerenders", () => {
    const onChange = vi.fn();
    const input = commandNumberInput(onChange);

    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "7" } });
    (input.props.onBlur as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "7" } });

    expect(onChange).toHaveBeenLastCalledWith(7);
  });
});
