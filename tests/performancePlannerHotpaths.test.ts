      const actual = accelerationBoundsForSpeedSquared(vector, (start + end) / 2, scalar, Math.max(start, end))!;
      expect(acceleration).toBeGreaterThanOrEqual(actual.minimum - 1e-7);
      expect(acceleration).toBeLessThanOrEqual(actual.maximum + 1e-7);
    }
  });
});
