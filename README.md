# Demo - Quick Start

## step.1

script: `npm install`

## step.2

script: `./build.sh`

## step.3

script: `npx http-server dist`

## step.4

see kws.worker.html (default: http://127.0.0.1:8080/kws.worker.html)


------

# Update model featTxt

## step.1

  put .txt under specific directory

  Ex. add `relajet_5.txt` under featTxt/relajet

## step.2

  update index file

  Ex. update relajet.txt --> add `featTxt/relajet/relajet_5.txt`

## step.3

  rebuild: execute `build.sh`

------


# Build main.bundle.js only

## step.1 (if already install, skip this step)

Install babel-preset-env: `npm install`

## step.2

build script: `npx babel-cli ./main.js  --out-file ./main.bundle.js && npx uglify-js ./main.bundle.js -o ./main.bundle.js --compress --mangle`

# Build relajet/relajet-en/kkbox features only

build script: `node readModelTxt.js`

# Build aubio.wasm/aubio.js

## see aubio project
