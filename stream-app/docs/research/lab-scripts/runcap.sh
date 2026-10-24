#!/bin/bash
cd /tmp/claude-0/research/lab
python3 capture.py fractal60 "Fractal garden" 60 60 120 2>&1 | grep -v -i proxy
echo DONE1
python3 capture.py living30 "Living picture" 30 36 60 2>&1 | grep -v -i proxy
echo DONE2
