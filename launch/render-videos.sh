make_still_clip "$script_dir/assets/product/feature-routines-1600x900.png" 4 "$work_dir/04-routines.mp4"
make_still_clip "$script_dir/assets/product/feature-java-1600x900.png" 4 "$work_dir/05-java.mp4"
make_still_clip "$script_dir/assets/video/end-card-1920x1080.png" 5 "$work_dir/06-end.mp4"

printf "file '%s'\n" \
  "$work_dir/01-title.mp4" \
  "$work_dir/02-plan.mp4" \
  "$work_dir/03-demo.mp4" \
  "$work_dir/04-routines.mp4" \
  "$work_dir/05-java.mp4" \
  "$work_dir/06-end.mp4" > "$work_dir/concat.txt"

"$ffmpeg_bin" -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$work_dir/concat.txt" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -movflags +faststart -shortest \
  "$script_dir/exports/bordeaux-launch-draft.mp4"

echo "Rendered website demo and launch draft."
