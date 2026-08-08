package dev.bordeaux.runtime;

import java.util.List;

/** Selects a monotonic trajectory reference from mixed time and position sections. */
public final class BordeauxReferenceFollower {
    private static final int POSITION_LOOKAHEAD_SAMPLES = 2;
    private static final double END_TOLERANCE_M = 0.08;

    private final List<BordeauxSample> samples;
    private final List<BordeauxFollowSection> sections;
    private int sectionIndex;
    private int sampleIndex;
    private double sectionElapsedS;
    private boolean finished;

    public BordeauxReferenceFollower(BordeauxPathEvents path) {
        if (path == null || path.samples().isEmpty() || path.followSections().isEmpty()) {
            throw new BordeauxRuntimeException("A trajectory with samples and follow sections is required");
        }
        samples = path.samples();
        sections = path.followSections();
        reset();
    }

    /** Advances one robot loop and returns the current reference sample. */
    public BordeauxSample update(double dtS, double measuredXM, double measuredYM) {
        if (!Double.isFinite(dtS) || dtS < 0 || !Double.isFinite(measuredXM) || !Double.isFinite(measuredYM)) {
            throw new BordeauxRuntimeException("Follower update values must be finite and dtS cannot be negative");
        }
        if (finished) return samples.get(sampleIndex);
        BordeauxFollowSection section = sections.get(sectionIndex);
        if (section.mode() == BordeauxFollowSection.Mode.TIME) {
            sectionElapsedS += dtS;
            double target = samples.get(section.startSample()).timeS() + sectionElapsedS;
            while (sampleIndex < section.endSample() && samples.get(sampleIndex + 1).timeS() <= target + 1e-9) {
                sampleIndex++;
            }
            double duration = samples.get(section.endSample()).timeS() - samples.get(section.startSample()).timeS();
            if (sampleIndex == section.endSample() && sectionElapsedS >= duration - 1e-9) advanceSection();
        } else {
            int nearest = sampleIndex;
            double nearestDistance = distance(samples.get(nearest), measuredXM, measuredYM);
            for (int index = sampleIndex + 1; index <= section.endSample(); index++) {
                double candidate = distance(samples.get(index), measuredXM, measuredYM);
                if (candidate < nearestDistance) {
                    nearest = index;
                    nearestDistance = candidate;
                }
            }
            sampleIndex = Math.min(section.endSample(), Math.max(sampleIndex, nearest + POSITION_LOOKAHEAD_SAMPLES));
            if (distance(samples.get(section.endSample()), measuredXM, measuredYM) <= END_TOLERANCE_M) {
                sampleIndex = section.endSample();
                advanceSection();
            }
        }
        return samples.get(sampleIndex);
    }

    public boolean isFinished() {
        return finished;
    }

    public int sectionIndex() {
        return sectionIndex;
    }

    public void reset() {
        sectionIndex = 0;
        sampleIndex = sections.get(0).startSample();
        sectionElapsedS = 0;
        finished = false;
    }

    private void advanceSection() {
        if (sectionIndex == sections.size() - 1) {
            finished = true;
            return;
        }
        sectionIndex++;
        sampleIndex = sections.get(sectionIndex).startSample();
        sectionElapsedS = 0;
    }

    private static double distance(BordeauxSample sample, double x, double y) {
        return Math.hypot(sample.xM() - x, sample.yM() - y);
    }
}
