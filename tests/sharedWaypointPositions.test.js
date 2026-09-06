    expectLocal(reconciled.paths[1].waypoints[0], geometry);
  });

  it.each(['', '   ', 12, null])('rejects invalid shared position ID %j', (positionLink) => {
    const project = fixture(); project.paths[0].waypoints[0].positionLink = positionLink;
    expect(validateProject(project).issues.some((issue) => issue.path.endsWith('.positionLink'))).toBe(true);
  });
});
