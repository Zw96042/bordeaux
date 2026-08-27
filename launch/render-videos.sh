#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(dirname "$script_dir")"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

ffmpeg_bin="${FFMPEG_BIN:-}"
rsvg_bin="${RSVG_CONVERT_BIN:-}"

if [[ -z "$ffmpeg_bin" ]]; then ffmpeg_bin="$(command -v ffmpeg || true)"; fi
if [[ -z "$rsvg_bin" ]]; then rsvg_bin="$(command -v rsvg-convert || true)"; fi

if [[ -z "$ffmpeg_bin" || -z "$rsvg_bin" ]]; then
  echo "FFmpeg and rsvg-convert are required to render the video exports." >&2
  exit 1
fi

mkdir -p "$script_dir/exports" "$repo_dir/marketing/assets/product"

"$rsvg_bin" -w 1280 -h 800 -o "$work_dir/editor-poster.png" "$repo_dir/marketing/assets/product/editor-poster.svg"
"$rsvg_bin" -w 80 -h 80 -o "$work_dir/robot-marker.png" "$repo_dir/marketing/assets/product/robot-marker.svg"

"$ffmpeg_bin" -hide_banner -loglevel error -y \
  -loop 1 -framerate 30 -t 18 -i "$work_dir/editor-poster.png" \
  -loop 1 -framerate 30 -t 18 -i "$work_dir/robot-marker.png" \
  -f lavfi -t 18 -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
  -filter_complex "[0:v]scale=1280:800,zoompan=z='min(zoom+0.00010,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x800:fps=30[bg];[1:v]format=rgba[marker];[bg][marker]overlay=x='356+720*min(max((t-1)/16,0),1)':y='456-274*min(max((t-1)/16,0),1)-130*sin(2*PI*min(max((t-1)/16,0),1))-60*sin(PI*min(max((t-1)/16,0),1))':enable='gte(t,1)',fade=t=in:st=0:d=0.35,fade=t=out:st=17.4:d=0.6,format=yuv420p[v]" \
  -map "[v]" -map 2:a \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 128k -movflags +faststart -t 18 -shortest \
  "$repo_dir/marketing/assets/product/bordeaux-demo.mp4"

cp "$repo_dir/marketing/assets/product/bordeaux-demo.mp4" "$script_dir/exports/bordeaux-product-demo.mp4"

make_still_clip() {
  local input_file="$1"
  local duration="$2"
  local output_file="$3"
  local frames
  frames="$(python3 -c "print(int(float('$duration') * 30))")"

  "$ffmpeg_bin" -hide_banner -loglevel error -y \
    -loop 1 -framerate 30 -i "$input_file" \
    -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.00012,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=$(python3 -c "print(max(float('$duration') - 0.35, 0))"):d=0.35,format=yuv420p" \
    -t "$duration" -an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 "$output_file"
}

startup_master="$repo_dir/prototypes/startup-animations/exports/spill-route.mp4"
if [[ -f "$startup_master" ]]; then
  "$ffmpeg_bin" -hide_banner -loglevel error -y \
    -i "$startup_master" \
    -vf "scale=1920:1200,crop=1920:1080,fps=30,tpad=stop_mode=clone:stop_duration=0.6,fade=t=out:st=3.65:d=0.35,format=yuv420p" \
    -t 4 -an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 \
    "$work_dir/01-title.mp4"
else
  echo "Spill / Route master not found; using the static title-card fallback." >&2
  make_still_clip "$script_dir/assets/video/title-card-1920x1080.png" 4 "$work_dir/01-title.mp4"
fi
make_still_clip "$script_dir/assets/video/chapter-plan-1920x1080.png" 2.5 "$work_dir/02-plan.mp4"

"$ffmpeg_bin" -hide_banner -loglevel error -y \
  -i "$repo_dir/marketing/assets/product/bordeaux-demo.mp4" \
  -vf "scale=1728:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#0a0a0b,fade=t=in:st=0:d=0.25,fade=t=out:st=17.6:d=0.4,format=yuv420p" \
  -an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 "$work_dir/03-demo.mp4"

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
