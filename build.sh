#!/bin/bash
###############################################################
# Please check build.sh is executable
# run `chmod +x build.sh` to make this shell script executable
###############################################################

echo -ne '                     (0%)\r'

# Clear
rm -rf dist

# Generate dist folder
mkdir dist

# Generate keyword features
node readModelTxt.js

echo -ne '####                 (20%)\r'

# Compile js scripts
npx babel-cli ./main.js  --out-file ./dist/main.bundle.js && npx uglify-js ./dist/main.bundle.js -o ./dist/main.bundle.js --compress --mangle

echo -ne '############         (50%)\r'
sleep 1

npx babel-cli ./worker.js  --out-file ./dist/worker.js && npx uglify-js ./dist/worker.js -o ./dist/worker.js --compress

echo -ne '##################   (90%)\r'
sleep 1

# Generate dist file

## html
cp ./index.html ./dist/index.html

## Web worker
cp ./wasm-worker.js ./dist/wasm-worker.js

## Web assembly
cp ./opencv_js.js ./dist/opencv_js.js
cp ./opencv.js ./dist/opencv.js
cp ./opencv_js.wasm ./dist/opencv_js.wasm
cp ./aubio.js ./dist/aubio.js
cp ./aubio.wasm ./dist/aubio.wasm

## Keyword Features
cp ./kkbox.js ./dist/kkbox.js
cp ./relajet.js ./dist/relajet.js
cp ./relajetEn.js ./dist/relajetEn.js

## Vendor (rxjs)
cp -r ./vendor ./dist

## Caffe Model
mkdir ./dist/RelaJet-KWS
cp -r ./RelaJet-KWS/model ./dist/RelaJet-KWS

echo -ne '####################     (100%)\r'
echo -ne '\n'

echo "Build Finished"