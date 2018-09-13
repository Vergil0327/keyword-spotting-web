var Module = {};
importScripts('opencv.js', 'aubio.js', 'relajet.js', 'relajetEn.js', 'kkbox.js', 'worker.js');
postMessage({msg: 'wasmLoaded'});