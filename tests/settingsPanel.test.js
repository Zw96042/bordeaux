  it.each([
    [{ pairing: null, busy: false, connectionLabel: 'Connect robot' }, 'Connect robot'],
    [{ pairing: { teamNumber: 2468 }, busy: false, connectionLabel: 'Team 2468' }, 'Manage connection'],
    [{ pairing: { teamNumber: 2468 }, busy: true, connectionLabel: 'Awaiting robot' }, 'Push progress'],
  ])('keeps connection and units available with the robot configuration', (pushController, label) => {
    const markup = renderToStaticMarkup(React.createElement(RobotPage, {
      robot: createDemoProject().robot, unitSystem: 'imperial', pushController,
    }));
    expect(markup).toContain(label);
    expect(markup).toContain('aria-label="Display units"');
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Imperial/);
    expect(markup).toContain('Drivetrain');
    expect(markup).not.toContain('<dialog');
  });
});
