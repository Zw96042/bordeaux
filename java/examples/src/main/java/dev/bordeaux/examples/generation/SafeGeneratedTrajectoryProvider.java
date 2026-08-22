                new BordeauxSample(0, 0, 0, 0,
                        context.xM(), context.yM(), heading, 0, 0, 0, 0, heading),
                new BordeauxSample(1, BRAKE_DURATION_S, brakeDistanceM, brakeDistanceM / distanceM,
                        brakeX, brakeY, brakeHeading, 0, 0, 0, 0, brakeHeading),
                new BordeauxSample(2, BRAKE_DURATION_S + durationS * 0.5,
                        brakeDistanceM + forwardDistanceM * 0.5,
                        (brakeDistanceM + forwardDistanceM * 0.5) / distanceM,
                        middleX, middleY, brakeHeading, 0, 0, 0, 0, brakeHeading),
                new BordeauxSample(3, BRAKE_DURATION_S + durationS, distanceM, 1,
                        endX, endY, brakeHeading, 0, 0, 0, 0, brakeHeading)));
    }
}
