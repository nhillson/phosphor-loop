#!/bin/bash
set -e; FPS=30; R=7500000; cd /tmp/claude-0/research/pipe/work
RAW="-f rawvideo -pix_fmt rgba -s 1920x1080 -r $FPS -i src60.rgba"
FIN="-c:v libx264 -preset medium -profile:v high -bf 2 -g 60 -b:v $R -maxrate $R -bufsize $R -x264-params nal-hrd=cbr"
ffmpeg -v error -y $RAW -pix_fmt rgb24 -f rawvideo ref.rgb
m() { ffmpeg -v error -y -i $1 -vf "scale=in_color_matrix=$2:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=rgb24" -f rawvideo out.rgb
  ffmpeg -v info -f rawvideo -pix_fmt rgb24 -s 1920x1080 -i out.rgb -f rawvideo -pix_fmt rgb24 -s 1920x1080 -i ref.rgb -lavfi "[0][1]ssim;[0][1]psnr" -f null - 2>&1 | grep -oE "SSIM .*All:[0-9.]+|PSNR .*average:[0-9.]+" | sed -E 's/SSIM.*All:/SSIM /;s/PSNR.*average:/PSNR /' | tr '\n' ' '; echo; }
ffmpeg -v error -y $RAW -vf scale=out_color_matrix=bt709:out_range=tv -pix_fmt yuv420p -c:v rawvideo -f nut s420.nut
echo -n "A 4:2:0 only, no encode:            "; m s420.nut bt709
ffmpeg -v error -y $RAW -vf scale=out_color_matrix=bt601:out_range=tv -pix_fmt yuv420p -c:v libx264 -preset veryfast -profile:v baseline -tune zerolatency -b:v 60M -maxrate 60M -bufsize 60M -x264-params nal-hrd=cbr st1.mkv
echo -n "B first stage only (60M baseline):  "; m st1.mkv bt601
ffmpeg -v error -y -i st1.mkv -pix_fmt yuv420p -colorspace bt709 $FIN cur.mp4
echo -n "C CURRENT (601 shown as 709):       "; m cur.mp4 bt709
echo -n "D current, colour read right:       "; m cur.mp4 bt601
ffmpeg -v error -y -i st1.mkv -vf scale=in_color_matrix=bt601:out_color_matrix=bt709 -pix_fmt yuv420p $FIN fix.mp4
echo -n "E current + matrix fix:             "; m fix.mp4 bt709
ffmpeg -v error -y $RAW -vf scale=out_color_matrix=bt709:out_range=tv -pix_fmt yuv420p $FIN new.mp4
echo -n "F PROPOSED single encode:           "; m new.mp4 bt709
