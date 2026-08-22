            return this;
        }

        public BordeauxDriveAdapter build() {
            Objects.requireNonNull(state, "state");
            Objects.requireNonNull(output, "output");
            Objects.requireNonNull(resetPose, "resetPose");
            Objects.requireNonNull(stop, "stop");
            Objects.requireNonNull(limits, "limits");
            return new BordeauxDriveAdapter(this);
        }
    }
}
