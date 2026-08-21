package frc.robot.paths;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import dev.bordeaux.runtime.BordeauxGenerationContext;
import dev.bordeaux.runtime.BordeauxTrajectoryGeneratorLimits;
import org.junit.jupiter.api.Test;

final class DynamicPathsTest {
    private static final BordeauxTrajectoryGeneratorLimits LIMITS =
            new BordeauxTrajectoryGeneratorLimits(40, 16, 4, 2, 2, 2, 2, 4, 8, 0.2);

    @Test
    void startsAtTheFusedPoseAndEndsAtTheRequestedOffset() {
        var context = new BordeauxGenerationContext(
                1, 2, 0, "field", "revision", "coordinates", LIMITS);

        var trajectory = new DynamicPaths().forward(context, 1.25);

        assertEquals(1, trajectory.samples().get(0).xM());
        assertEquals(2, trajectory.samples().get(0).yM());
        assertEquals(2.25, trajectory.samples().get(3).xM());
        assertEquals(2, trajectory.samples().get(3).yM());
    }

    @Test
    void rejectsTheIntroductoryGeneratorWhileMoving() {
        var context = new BordeauxGenerationContext(
                0, 0, 0, "field", "revision", "coordinates", LIMITS, 0.2, 0, 0);

        assertThrows(IllegalStateException.class, () -> new DynamicPaths().forward(context, 1));
    }
}
