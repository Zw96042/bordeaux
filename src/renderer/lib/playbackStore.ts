    reset() { stopFrame(); emit({ time: 0, playing: false }); },
    destroy() { stopFrame(); listeners.clear(); },
  };
}
