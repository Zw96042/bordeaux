      mutate(tampered.optimization!.accepted!.result);
      expect(getAcceptedTrajectory(tampered, project.robot)).toBeNull();
    }
  });
});
