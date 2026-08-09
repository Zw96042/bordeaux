package dev.bordeaux.runtime;

import java.util.List;

/** Selects a monotonic trajectory reference from mixed time and position sections. */
public final class BordeauxReferenceFollower {
    private static final int POSITION_LOOKAHEAD_SAMPLES = 2;
    private static final double END_TOLERANCE_M = 0.08;

    private final List<BordeauxSample> samples;
    private final List<BordeauxFollowSection> sections;
    private final PositionIndex[] positionIndexes;
    private int sectionIndex;
    private int sampleIndex;
    private int measuredSampleIndex;
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
        if (section.mode() == BordeauxFollowSection.Mode.TIME) {
            sectionElapsedS += dtS;
            double target = samples.get(section.startSample()).timeS() + sectionElapsedS;
            while (sampleIndex < section.endSample() && samples.get(sampleIndex + 1).timeS() <= target + 1e-9) {
                sampleIndex++;
            }
            double duration = samples.get(section.endSample()).timeS() - samples.get(section.startSample()).timeS();
            if (sampleIndex == section.endSample() && sectionElapsedS >= duration - 1e-9) advanceSection();
        } else {
            PositionIndex.SearchResult nearest = positionIndexes[sectionIndex]
                    .nearest(measuredSampleIndex, measuredXM, measuredYM);
            measuredSampleIndex = nearest.sampleIndex();
            lastSearchSamples = nearest.samplesChecked();
            sampleIndex = Math.min(section.endSample(), measuredSampleIndex + POSITION_LOOKAHEAD_SAMPLES);
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
        measuredSampleIndex = sampleIndex;
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
        sectionElapsedS = 0;
    }

    private static double distance(BordeauxSample sample, double x, double y) {
        return Math.hypot(sample.xM() - x, sample.yM() - y);
    }

    /** Exact nearest-sample lookup with the same monotonic/tie semantics as a forward scan. */
    private static final class PositionIndex {
        private final List<BordeauxSample> samples;
        private final Node root;

        private PositionIndex(List<BordeauxSample> samples, int startSample, int endSample) {
            this.samples = samples;
            int[] order = new int[endSample - startSample + 1];
            for (int index = 0; index < order.length; index++) order[index] = startSample + index;
            root = build(order, 0, order.length, 0);
        }

        private SearchResult nearest(int minimumIndex, double x, double y) {
            BordeauxSample initial = samples.get(minimumIndex);
            Search search = new Search(minimumIndex,
                    squared(initial.xM() - x) + squared(initial.yM() - y));
            search(root, minimumIndex, x, y, search);
            return new SearchResult(search.sampleIndex, search.samplesChecked);
        }

        private void search(Node node, int minimumIndex, double x, double y, Search best) {
            if (node == null || node.maximumIndex < minimumIndex) return;
            double lowerBound = node.distanceSquaredToBounds(x, y);
            if (lowerBound > best.distanceSquared
                    || (lowerBound == best.distanceSquared && node.minimumIndex >= best.sampleIndex)) return;

            if (node.sampleIndex >= minimumIndex) {
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
            search(first, minimumIndex, x, y, best);
            search(second, minimumIndex, x, y, best);
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
