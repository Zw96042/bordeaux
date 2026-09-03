  it('never treats unknown, stale, or changed inputs as a match', () => {
    const now = Date.now(), verifiedAt = new Date(now).toISOString();
    const matches = { state: 'matches' };
    expect(deploymentItemStatus(matches, 'a', 'a', verifiedAt, now).label).toBe('Matches robot');
    expect(deploymentItemStatus(matches, 'a', 'b', verifiedAt, now).label).toBe('Changed');
    expect(deploymentItemStatus(matches, 'a', 'a', verifiedAt, now + 60_001).label).toBe('Unknown');
    expect(deploymentItemStatus(null, 'a', 'a', verifiedAt, now).label).toBe('Unknown');
  });
});
