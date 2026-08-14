package dev.bordeaux.runtime;

import java.util.List;

/** Selects a monotonic trajectory reference from mixed time and position sections. */
public final class BordeauxReferenceFollower {
    private static final int POSITION_LOOKAHEAD_SAMPLES = 2;
    private static final double END_TOLERANCE_M = 0.08;
    private static final double POSITION_PROGRESS_TOLERANCE_M = 0.08;

    private final List<BordeauxSample> samples;
    private final List<BordeauxFollowSection> sections;
    private final PositionIndex[] positionIndexes;
    private int sectionIndex;
    private int sampleIndex;
    private int measuredSampleIndex;
    private int permittedSampleIndex;
    private double lastMeasuredXM;
    private double lastMeasuredYM;
    private boolean hasMeasuredPosition;
    private double sectionElapsedS;
    private boolean finished;
    private int lastSearchSamples;

    public BordeauxReferenceFollower(BordeauxPathEvents path) {
        if (path == null || path.samples().isEmpty() || path.followSections().isEmpty()) {
            throw new BordeauxRuntimeException("A trajectory with samples and follow sections is required");
        }
        samples = path.samples();
        sections = path.followSections();
        positionIndexes = new PositionIndex[sections.size()];
        for (int index = 0; index < sections.size(); index++) {
            BordeauxFollowSection section = sections.get(index);
            if (section.mode() == BordeauxFollowSection.Mode.POSITION) {
                positionIndexes[index] = new PositionIndex(samples, section.startSample(), section.endSample());
            }
        }
        reset();
    }

    /** Advances one robot loop and returns the current reference sample. */
    public BordeauxSample update(double dtS, double measuredXM, double measuredYM) {
        if (!Double.isFinite(dtS) || dtS < 0 || !Double.isFinite(measuredXM) || !Double.isFinite(measuredYM)) {
            throw new BordeauxRuntimeException("Follower update values must be finite and dtS cannot be negative");
        }
        if (finished) return samples.get(sampleIndex);
        BordeauxFollowSection section = sections.get(sectionIndex);
        BordeauxSample reference = null;
        if (section.mode() == BordeauxFollowSection.Mode.TIME) {
            double remainingTimeS = dtS;
            while (!finished && section.mode() == BordeauxFollowSection.Mode.TIME) {
                sectionElapsedS += remainingTimeS;
                double target = samples.get(section.startSample()).timeS() + sectionElapsedS;
                while (sampleIndex < section.endSample()
                        && samples.get(sampleIndex + 1).timeS() <= target + 1e-9) {
                    sampleIndex++;
                }
                reference = interpolateTimeReference(section, target);
                double duration = samples.get(section.endSample()).timeS()
                        - samples.get(section.startSample()).timeS();
                if (sampleIndex < section.endSample() || sectionElapsedS < duration - 1e-9) break;
                remainingTimeS = Math.max(0, sectionElapsedS - duration);
                advanceSection();
                if (!finished) {
                    section = sections.get(sectionIndex);
                    reference = null;
                }
            }
        } else {
            updateMeasuredTravel(section, measuredXM, measuredYM);
            int searchStart = positionIndexes[sectionIndex].endOfCoincidentRun(measuredSampleIndex);
            PositionIndex.SearchResult nearest = positionIndexes[sectionIndex]
                    .nearest(searchStart, permittedSampleIndex, measuredXM, measuredYM);
            measuredSampleIndex = nearest.sampleIndex();
            lastSearchSamples = nearest.samplesChecked();
            sampleIndex = Math.min(section.endSample(), measuredSampleIndex + POSITION_LOOKAHEAD_SAMPLES);
            if (measuredSampleIndex == section.endSample()
                    && distance(samples.get(section.endSample()), measuredXM, measuredYM) <= END_TOLERANCE_M) {
                sampleIndex = section.endSample();
                advanceSection();
            }
        }
        return reference != null ? reference : samples.get(sampleIndex);
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
        measuredSampleIndex = sampleIndex;
        permittedSampleIndex = sampleIndex;
        hasMeasuredPosition = false;
        sectionElapsedS = 0;
        finished = false;
        lastSearchSamples = 0;
    }

    int lastSearchSamples() {
        return lastSearchSamples;
    }

    private void advanceSection() {
        if (sectionIndex == sections.size() - 1) {
            finished = true;
            return;
        }
        sectionIndex++;
        sampleIndex = sections.get(sectionIndex).startSample();
        measuredSampleIndex = sampleIndex;
        permittedSampleIndex = sampleIndex;
        hasMeasuredPosition = false;
        sectionElapsedS = 0;
    }

    private void updateMeasuredTravel(BordeauxFollowSection section, double measuredXM, double measuredYM) {
        double measuredStepM;
        if (hasMeasuredPosition) {
            measuredStepM = Math.hypot(measuredXM - lastMeasuredXM, measuredYM - lastMeasuredYM);
        } else {
            measuredStepM = distance(samples.get(measuredSampleIndex), measuredXM, measuredYM);
            hasMeasuredPosition = true;
        }
        lastMeasuredXM = measuredXM;
        lastMeasuredYM = measuredYM;
        permittedSampleIndex = positionIndexes[sectionIndex]
                .maximumIndexAtTravel(measuredSampleIndex, measuredStepM + POSITION_PROGRESS_TOLERANCE_M);
    }

    private static double distance(BordeauxSample sample, double x, double y) {
        return Math.hypot(sample.xM() - x, sample.yM() - y);
    }

    private BordeauxSample interpolateTimeReference(BordeauxFollowSection section, double targetTimeS) {
        BordeauxSample before = samples.get(sampleIndex);
        if (sampleIndex >= section.endSample()) return before;
        BordeauxSample after = samples.get(sampleIndex + 1);
        double durationS = after.timeS() - before.timeS();
        if (durationS <= 1e-9) return after;
        double progress = Math.max(0, Math.min(1, (targetTimeS - before.timeS()) / durationS));
        double headingDelta = Math.atan2(
                Math.sin(after.headingRad() - before.headingRad()),
                Math.cos(after.headingRad() - before.headingRad()));
        return new BordeauxSample(
                before.index(),
                lerp(before.timeS(), after.timeS(), progress),
                lerp(before.distanceM(), after.distanceM(), progress),
                lerp(before.fraction(), after.fraction(), progress),
                lerp(before.xM(), after.xM(), progress),
                lerp(before.yM(), after.yM(), progress),
                before.headingRad() + headingDelta * progress,
                lerp(before.velocityMps(), after.velocityMps(), progress));
    }

    private static double lerp(double before, double after, double progress) {
        return before + (after - before) * progress;
    }

    /** Exact nearest-sample lookup inside a monotonic, measured-travel progress window. */
    private static final class PositionIndex {
        private final List<BordeauxSample> samples;
        private final int startSample;
        private final double[] travelFromStart;
        private final Node root;

        private PositionIndex(List<BordeauxSample> samples, int startSample, int endSample) {
            this.samples = samples;
            this.startSample = startSample;
            int[] order = new int[endSample - startSample + 1];
            for (int index = 0; index < order.length; index++) order[index] = startSample + index;
            travelFromStart = new double[order.length];
            for (int index = 1; index < order.length; index++) {
                BordeauxSample previous = samples.get(order[index - 1]);
                BordeauxSample current = samples.get(order[index]);
                travelFromStart[index] = travelFromStart[index - 1]
                        + Math.hypot(current.xM() - previous.xM(), current.yM() - previous.yM());
            }
            root = build(order, 0, order.length, 0);
        }

        private int maximumIndexAtTravel(int minimumIndex, double maximumTravelM) {
            int minimumOffset = minimumIndex - startSample;
            double targetTravelM = travelFromStart[minimumOffset] + maximumTravelM;
            int low = minimumOffset;
            int high = travelFromStart.length;
            while (low < high) {
                int middle = (low + high) >>> 1;
                if (travelFromStart[middle] <= targetTravelM) low = middle + 1;
                else high = middle;
            }
            int maximumOffset = Math.max(minimumOffset, low - 1);
            if (maximumOffset == minimumOffset && maximumOffset + 1 < travelFromStart.length) maximumOffset++;
            return startSample + maximumOffset;
        }

        private int endOfCoincidentRun(int minimumIndex) {
            int minimumOffset = minimumIndex - startSample;
            double targetTravelM = travelFromStart[minimumOffset] + 1e-9;
            int low = minimumOffset;
            int high = travelFromStart.length;
            while (low < high) {
                int middle = (low + high) >>> 1;
                if (travelFromStart[middle] <= targetTravelM) low = middle + 1;
                else high = middle;
            }
            return startSample + Math.max(minimumOffset, low - 1);
        }

        private SearchResult nearest(int minimumIndex, int maximumIndex, double x, double y) {
            BordeauxSample initial = samples.get(minimumIndex);
            Search search = new Search(minimumIndex,
                    squared(initial.xM() - x) + squared(initial.yM() - y));
            search(root, minimumIndex, maximumIndex, x, y, search);
            return new SearchResult(search.sampleIndex, search.samplesChecked);
        }

        private void search(Node node, int minimumIndex, int maximumIndex, double x, double y, Search best) {
            if (node == null || node.maximumIndex < minimumIndex || node.minimumIndex > maximumIndex) return;
            double lowerBound = node.distanceSquaredToBounds(x, y);
            if (lowerBound > best.distanceSquared
                    || (lowerBound == best.distanceSquared && node.minimumIndex >= best.sampleIndex)) return;

            if (node.sampleIndex >= minimumIndex && node.sampleIndex <= maximumIndex) {
                BordeauxSample sample = samples.get(node.sampleIndex);
                double candidate = squared(sample.xM() - x) + squared(sample.yM() - y);
                best.samplesChecked++;
                if (candidate < best.distanceSquared
                        || (candidate == best.distanceSquared && node.sampleIndex < best.sampleIndex)) {
                    best.sampleIndex = node.sampleIndex;
                    best.distanceSquared = candidate;
                }
            }

            Node first = node.left;
            Node second = node.right;
            if (compareBounds(second, first, x, y) < 0) {
                first = node.right;
                second = node.left;
            }
            search(first, minimumIndex, maximumIndex, x, y, best);
            search(second, minimumIndex, maximumIndex, x, y, best);
        }

        private static int compareBounds(Node left, Node right, double x, double y) {
            if (left == null) return right == null ? 0 : 1;
            if (right == null) return -1;
            int distance = Double.compare(left.distanceSquaredToBounds(x, y), right.distanceSquaredToBounds(x, y));
            return distance != 0 ? distance : Integer.compare(left.minimumIndex, right.minimumIndex);
        }

        private Node build(int[] order, int start, int end, int depth) {
            if (start >= end) return null;
            int middle = (start + end) >>> 1;
            select(order, start, end - 1, middle, depth & 1);
            int sampleIndex = order[middle];
            return new Node(sampleIndex,
                    build(order, start, middle, depth + 1),
                    build(order, middle + 1, end, depth + 1),
                    samples.get(sampleIndex));
        }

        private void select(int[] order, int low, int high, int target, int axis) {
            while (low < high) {
                int pivot = partition(order, low, high, (low + high) >>> 1, axis);
                if (pivot == target) return;
                if (target < pivot) high = pivot - 1;
                else low = pivot + 1;
            }
        }

        private int partition(int[] order, int low, int high, int pivotIndex, int axis) {
            int pivot = order[pivotIndex];
            swap(order, pivotIndex, high);
            int destination = low;
            for (int index = low; index < high; index++) {
                if (compare(order[index], pivot, axis) < 0) swap(order, destination++, index);
            }
            swap(order, destination, high);
            return destination;
        }

        private int compare(int leftIndex, int rightIndex, int axis) {
            BordeauxSample left = samples.get(leftIndex);
            BordeauxSample right = samples.get(rightIndex);
            double leftValue = axis == 0 ? left.xM() : left.yM();
            double rightValue = axis == 0 ? right.xM() : right.yM();
            int value = Double.compare(leftValue, rightValue);
            return value != 0 ? value : Integer.compare(leftIndex, rightIndex);
        }

        private static void swap(int[] values, int left, int right) {
            int value = values[left];
            values[left] = values[right];
            values[right] = value;
        }

        private static double squared(double value) {
            return value * value;
        }

        private record SearchResult(int sampleIndex, int samplesChecked) {}

        private static final class Search {
            private int sampleIndex;
            private double distanceSquared;
            private int samplesChecked;

            private Search(int sampleIndex, double distanceSquared) {
                this.sampleIndex = sampleIndex;
                this.distanceSquared = distanceSquared;
            }
        }

        private static final class Node {
            private final int sampleIndex;
            private final Node left;
            private final Node right;
            private final int minimumIndex;
            private final int maximumIndex;
            private final double minimumX;
            private final double maximumX;
            private final double minimumY;
            private final double maximumY;

            private Node(int sampleIndex, Node left, Node right, BordeauxSample sample) {
                this.sampleIndex = sampleIndex;
                this.left = left;
                this.right = right;
                minimumIndex = Math.min(sampleIndex, Math.min(minimumIndex(left), minimumIndex(right)));
                maximumIndex = Math.max(sampleIndex, Math.max(maximumIndex(left), maximumIndex(right)));
                minimumX = Math.min(sample.xM(), Math.min(minimumX(left), minimumX(right)));
                maximumX = Math.max(sample.xM(), Math.max(maximumX(left), maximumX(right)));
                minimumY = Math.min(sample.yM(), Math.min(minimumY(left), minimumY(right)));
                maximumY = Math.max(sample.yM(), Math.max(maximumY(left), maximumY(right)));
            }

            private double distanceSquaredToBounds(double x, double y) {
                double dx = x < minimumX ? minimumX - x : x > maximumX ? x - maximumX : 0;
                double dy = y < minimumY ? minimumY - y : y > maximumY ? y - maximumY : 0;
                return dx * dx + dy * dy;
            }

            private static int minimumIndex(Node node) {
                return node == null ? Integer.MAX_VALUE : node.minimumIndex;
            }

            private static int maximumIndex(Node node) {
                return node == null ? Integer.MIN_VALUE : node.maximumIndex;
            }

            private static double minimumX(Node node) {
                return node == null ? Double.POSITIVE_INFINITY : node.minimumX;
            }

            private static double maximumX(Node node) {
                return node == null ? Double.NEGATIVE_INFINITY : node.maximumX;
            }

            private static double minimumY(Node node) {
                return node == null ? Double.POSITIVE_INFINITY : node.minimumY;
            }

            private static double maximumY(Node node) {
                return node == null ? Double.NEGATIVE_INFINITY : node.maximumY;
            }
        }
    }
}
