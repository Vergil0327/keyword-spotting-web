/**
|--------------------------------------------------
| Compile steps of main.bundle.js
|
| step.1:
| npx babel-cli ./main.js --out-file ./<wanted path>/main.bundle.js
|
| step.2:
| npx uglify-js ./<wanted path>/main.bundle.js -o ./<wanted path>/main.bundle.js --compress --mangle
|--------------------------------------------------
*/

/**
 * Init webassembly worker
 */
let wasmWorker = new Worker('wasm-worker.js');

/**
 * Rxjs
 * verdor/rx.js
 * global variable name: rxjs
 */
const {fromEvent, operators, from, BehaviorSubject} = rxjs
const {filter, tap, map} = operators

/* Compatiable polyfill for navigator.getUserMedia */
const promisifiedOldGUM = function(constraints) {
  // First get ahold of getUserMedia, if present
  const getUserMedia =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia;

  // Some browsers just don't implement it - return a rejected promise with an error
  // to keep a consistent interface
  if (!getUserMedia) {
    return Promise.reject(
      new Error('getUserMedia is not implemented in this browser')
    );
  }

  // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
  return new Promise(function(resolve, reject) {
    getUserMedia.call(navigator, constraints, resolve, reject);
  });
};

// Older browsers might not implement mediaDevices at all, so we set an empty object first
if (navigator.mediaDevices === undefined) {
  navigator.mediaDevices = {};
}

// Some browsers partially implement mediaDevices. We can't just assign an object
// with getUserMedia as it would overwrite existing properties.
// Here, we will just add the getUserMedia property if it's missing.
if (navigator.mediaDevices.getUserMedia === undefined) {
  navigator.mediaDevices.getUserMedia = promisifiedOldGUM;
}

/* Audio Related Types */
const INIT = 'init';
const CPATURE_AUDIO_STOPPED = 'captureAudioStopped';
const CAPTURE_AUDIO_STARTED = 'captureAudioStarted';

/* WASM Worker Related Types */
const WASM_LOADED = 'wasmLoaded';
const STATUS_CHANGED = 'statusChanged';
const LOAD_MODELS_FINISHED = 'loadModelsFinished';
const INFERENCE_FULFILLED = 'inferenceFulfilled';
const AUDIO_PREPROCESS_FULFILLED = 'audioPreprocessFulfilled';
const PREDICT_FULFILLED = 'predictFulfilled';

/**
 * Init Audio Source & Analyser
 * Sample Rate: 44100 (readOnly, changed by device hardware)
 * @see https://sonoport.github.io/visualising-waveforms-with-web-audio.html
 */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 2048;
const bufferLength = analyser.frequencyBinCount; // halffrom analyser.fftSize
const dataArray = new Uint8Array(bufferLength);
const MEDIA_CONSTRAINT = { audio: true, video: false };
const SCRIPT_PROCESSOR_OPTIONS = { bufferSize: 2048, numberOfInputChannels: 1, numberOfOutputChannels: 1 }
let recordStatus = INIT;

/**
 * Window onload event handler
 */
window.onload = () => main();

function main() {
  /* Dom */
  const $buttonML = document.getElementById('mlButton');
  const $buttonVisualize = document.getElementById('visualizeButton');
  const $errorMessage = document.getElementById('error');
  const $result = document.getElementById('result');
  const $statusWorker = document.getElementById('workerStatus');
  const $statusMicrophone = document.getElementById('microphoneStatus');
  const $canvas = document.getElementById('output')
  const $threshold = document.getElementById('threshold');
  const $inputThreshold = document.querySelector('.threshold input')
  const $buttonThreshold = document.querySelector('.threshold button')

  // load wav file to buffer
  // const $file = document.getElementById('file')
  // fromEvent($file, 'change').subscribe(event => {
  //   const wavFile = event.target.files[0];

  //   var fileReader  = new FileReader;
  //   fileReader.onload = function(event){
  //     var arrayBuffer = event.currentTarget.result;

  //     audioCtx.decodeAudioData(arrayBuffer)
  //       .then(audioBuffer => {
  //         console.log(audioBuffer)
  //         // console.log(audioBuffer.getChannelData(0))
  //         resampleAudioBuffer(audioBuffer, 16000, ({getAudioBuffer}) => {
  //           // const buffer = getAudioBuffer()
  //           // var $download = document.getElementById('download')
  //           // const file = new Blob(buffer)
  //           // console.log(file)
  //           // console.log('=== file')
  //           // $download.download = URL.createObjectURL(file)
  //         })
  //         wasmWorker.postMessage({ cmd: 'preprocess', testValue: audioBuffer.getChannelData(0) });
  //       })

  //   }
  //   fileReader.readAsArrayBuffer(wavFile);

  // })

  /**
  |--------------------------------------------------
  | Set Threshold Value
  |--------------------------------------------------
  */
  let inputValue;
  const onChangeInputThreshold$ = fromEvent($inputThreshold, 'input').pipe(
    map(event => event.target.value)
  )
  const onClickBtnThreshold$ = fromEvent($buttonThreshold, 'click').pipe(
    map(event => event),
  )
  onClickBtnThreshold$.subscribe(() => {
    if (!inputValue) return;

    const payload = parseFloat(inputValue)
    const isFloatNumber = /([0-9]*[.])?[0-9]+/
    if (!isFloatNumber.test(payload)) {
      console.log(`payload is ${payload}, not a number`)
      return;
    }

    wasmWorker.postMessage({ cmd: 'setThreshold', payload: inputValue })
    inputValue = undefined;
  })
  onChangeInputThreshold$
    .subscribe(value => inputValue = value)

  /**
  |--------------------------------------------------
  | Control Visualization
  |--------------------------------------------------
  */
  const audioStatus$ = new BehaviorSubject(recordStatus);
  const onClickButtonVisualize$ = fromEvent($buttonVisualize, 'click').pipe(
    map(event => event.target)
  );

  /* Helper */
  let rafId;
  const drawCanvas = function() {
    // Retrieve Audio Data
    analyser.getByteTimeDomainData(dataArray);
    rafId = requestAnimationFrame(drawCanvas);

    const canvasCtx = $canvas.getContext('2d');
    canvasCtx.fillStyle = 'rgb(255, 255, 255)';
    canvasCtx.fillRect(0, 0, $canvas.width, $canvas.height);
    canvasCtx.lineWidth = 1;
    canvasCtx.strokeStyle = 'rgb(0,213,242)';
    canvasCtx.beginPath();
    const sliceWidth = ($canvas.width * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i += 1) {
      const v = dataArray[i] / 128.0;
      const y = (v * $canvas.height) / 2;

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }
    canvasCtx.lineTo($canvas.width, $canvas.height / 2);
    canvasCtx.stroke();
  }

  /* $buttonVisualize event stream */
  onClickButtonVisualize$
    .pipe(
      tap(target => {
        switch (target.getAttribute('status')) {
          case INIT:
          case CPATURE_AUDIO_STOPPED:
            target.setAttribute('status', CAPTURE_AUDIO_STARTED);
            target.innerHTML = 'Stop';
            break;
          case CAPTURE_AUDIO_STARTED:
            target.setAttribute('status', CPATURE_AUDIO_STOPPED);
            target.innerHTML = 'Start';
            break;
          default:
            break;
        }
      }),
      map(target => target.getAttribute('status'))
    )
    .subscribe(status => {
      audioStatus$.next(status)
    })

    audioStatus$.subscribe(status => {
    console.log('Audio Status:', status);
    switch (status) {
      case CAPTURE_AUDIO_STARTED:
      drawCanvas()
      break;
      case CPATURE_AUDIO_STOPPED:
        cancelAnimationFrame(rafId)
        break;
      default:
        break;
    }
  })

  /**
  |--------------------------------------------------
  | Communication with wasmWorker
  |--------------------------------------------------
  */
  let predicateHistory = [];
  const onMessageWasmWorker$ = fromEvent(wasmWorker, 'message').pipe(
    map(event => event.data)
  )

  /* wasm worker onMessage handler */
  onMessageWasmWorker$.subscribe(data => {
    // console.log('Received From Worker:', data);
    switch (data.msg) {
      case WASM_LOADED:
        console.log('Done loading worker');
        break;
      case STATUS_CHANGED:
        $statusWorker.innerHTML = data.statusText;
        break;
      case LOAD_MODELS_FINISHED:
        console.log('Load Models Finished', 'success')
        $buttonML.style.display = 'none';
        $buttonVisualize.disabled = data.disabled;
        $buttonThreshold.disabled = data.disabled
        $buttonVisualize.style.visibility = data.disabled ? 'hidden' : 'visible';
        break;
      case INFERENCE_FULFILLED:
        wasmWorker.postMessage({ cmd: 'predict', payload: data.feat })
        break;
      case AUDIO_PREPROCESS_FULFILLED:
        const audioEnergies = data.payload.reduce((prev, curr) => [...prev, ...curr]); // flatten array
        wasmWorker.postMessage({ cmd: 'inference', audioEnergies })
        break;
      case PREDICT_FULFILLED:
        // console.log('PREDICT_FULFILLED:', data);
        // only show 5 results
        if (predicateHistory.length >= 5) predicateHistory.pop();

        // remove red color from past result
        if (predicateHistory.length > 0) predicateHistory[0] = predicateHistory[0].replace('red', '')
        
        // mark current result to red color
        if (data.predicate) predicateHistory.unshift(`<font color="red">${data.predicate}</font>`);

        $result.innerHTML = predicateHistory.join(' | ');
        break;
      case 'setThresholdFulfilled':
        $threshold.innerHTML = data.payload
        break;
      default:
        break;
    }
  })

  /**
  |--------------------------------------------------
  | Load Caffe Model
  |--------------------------------------------------
  */
  const onClickButtonML$ = fromEvent($buttonML, 'click').pipe(
    map(event => event.target)
  );

  /* $buttonML event stream */
  onClickButtonML$.subscribe(target => {
    switch (target.innerHTML) {
      case 'Load Model':
        target.disabled = true;
        $statusWorker.innerHTML = 'Loading Caffe Model...';
        wasmWorker.postMessage({ cmd: 'loadModels' });
        break;
      default:
        break;
    }
  })

  /**
  |--------------------------------------------------
  | Navigator Section
  | - Check microphone permission
  | - Get microphone audio data
  |--------------------------------------------------
  */
  let microphonePermission;

  if (navigator.permissions) {
    navigator.permissions.query({ name: 'microphone' })
      .then(
        permissionStatus => {
          microphonePermission = permissionStatus.state;
          $statusMicrophone.innerHTML = permissionStatus.state;

          if (microphonePermission !== 'granted') {
            $buttonVisualize.disabled = true;
            $buttonML.disabled = true;
          }

          permissionStatus.onchange = evt => {
            if (microphonePermission !== 'granted') {
              $buttonVisualize.disabled = true;
              $buttonML.disabled = true;
            }

            $statusMicrophone.innerHTML = evt.currentTarget.state;
          }
        }
      )
  }

  if (navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINT)
      .then(((stream) => {
        const audioSource = audioCtx.createMediaStreamSource(stream);
        const scriptNode = audioCtx.createScriptProcessor(SCRIPT_PROCESSOR_OPTIONS.bufferSize, SCRIPT_PROCESSOR_OPTIONS.numberOfInputChannels, SCRIPT_PROCESSOR_OPTIONS.numberOfOutputChannels);

        scriptNode.onaudioprocess = function(audioProcessingEvent) {
          let isAudioCapturing;
          audioStatus$.subscribe(status => {
          isAudioCapturing = status === CAPTURE_AUDIO_STARTED
        })
        if (!isAudioCapturing) return; 
        
        /**
         * The buffer contains data in the following format:
           * non-interleaved IEEE754 32-bit linear PCM with a nominal range between -1 and +1,
           * that is, 32bits floating point buffer, with each samples between -1.0 and 1.0. 
           */
          const {inputBuffer} = audioProcessingEvent;

          resampleAudioBuffer(inputBuffer, 16000, ({getAudioBuffer}) => {
            let resampledAudioBuffer = getAudioBuffer()
            const resampleChannelData = resampledAudioBuffer.getChannelData(0)

            wasmWorker.postMessage({ cmd: 'preprocess', testValue: resampleChannelData });
          })
        }

        audioSource.connect(analyser)
        analyser.connect(scriptNode)
        scriptNode.connect(audioCtx.destination)
      }));
    
  }
}

/**
 * @see https://github.com/notthetup/resampler/blob/gh-pages/lib/resampler.js
 *
 * @param {AudioBuffer} audioBuffer
 * @param {number} targetSampleRate
 * @param {Function} onComplete - callback ({ getAudioBuffer: void => AudioBuffer }) => void
 */
function resampleAudioBuffer(audioBuffer, targetSampleRate, onComplete) {
  var numCh_ = audioBuffer.numberOfChannels;
  var numFrames_ = audioBuffer.length * targetSampleRate / audioBuffer.sampleRate;

  var offlineContext_ = new OfflineAudioContext(numCh_, numFrames_, targetSampleRate);
  var bufferSource_ = offlineContext_.createBufferSource();
  bufferSource_.buffer = audioBuffer;

  // console.log('Starting Offline Rendering');
  bufferSource_.connect(offlineContext_.destination);
  bufferSource_.start(0);
  offlineContext_.startRendering().then((buffer) => {
    // console.log(buffer)
    // console.log('===== resample buffer')

    // var $play = document.getElementById('play')

    // $play.onclick = function() {
    //   var song = audioCtx.createBufferSource();
    // song.buffer = buffer;

    // song.connect(audioCtx.destination);
    //   console.log('play')
    //   song.start();

    // }
    onComplete({
      getAudioBuffer: () => buffer
    })
    // console.log('Done Rendering');
  })
}
