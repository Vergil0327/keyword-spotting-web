// aubio constraint
const AUBIO_TOTAL_INPUT_SIZE = 512;

// aubio pre-process
const queue = []
let cache = new Float32Array(0);

// opencv
var net = undefined; // dnn-net
var isOpencvInitialized = false;

// wake-up keyword vectors
const relajetCnVec = getRelajet()
const relajetEnVec = getRelajetEn()
const kkboxVec = getKkbox()

// wake-up threshold
let threshold = 0.65;

// Heler func for loading caffe model
function loadCaffeModel({protoPath, modelPath}, callback) {
  return fetch(protoPath)
    .then(response => response.arrayBuffer())
    .then(protoTxt =>
      fetch(modelPath)
        .then(res => res.arrayBuffer())
        .then(caffeModel => {
          /* Convert arrayBuffer to Uint8Array */
          let protoTxtData = new Uint8Array(protoTxt);
          let caffeModelData = new Uint8Array(caffeModel);

          /* Get file name */
          let protoPathArr = protoPath.split('/');
          let modelPathArr = modelPath.split('/');
          let protoFileName = protoPathArr[protoPathArr.length - 1]
          let modelFileName = modelPathArr[modelPathArr.length - 1]

          /* Create caffe model file */
          cv.FS_createDataFile('/', protoFileName, protoTxtData, true, false, false);
          cv.FS_createDataFile('/', modelFileName, caffeModelData, true, false, false);

          /* Read caffe model file */
          net = cv.readNetFromCaffe(protoFileName, modelFileName);

          self.postMessage({ msg: 'statusChanged', statusText: 'Load Caffe Model Finished' })

          callback()
        })
  )
}

// Helper func for concat typedArray
function concatenate(resultConstructor, ...arrays) {
  let totalLength = 0;
  for (let arr of arrays) {
      totalLength += arr.length;
  }
  let result = new resultConstructor(totalLength);
  let offset = 0;
  for (let arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
  }
  return result;
}

// Helper for WASM
function arrayToHeap(typedArray, Module) {
  const numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
  const ptr = Module._malloc(numBytes);
  const heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
  heapBytes.set(new Uint8Array(typedArray.buffer));
  return heapBytes;
}

function freeArray(heapBytes, Module) {
  Module._free(heapBytes.byteOffset);
}

function aubioProcess(audioInput, cb) {
  // send to aubio
  return aubio().then(wasmApi => {
    let pointerHeapBytes;
    let energyDataHeapBytes;
    let inputAudioHeapBytes;
    const audioEnergyData = audioInput.map(element => {
      // malloc a memory for audio buffer
      inputAudioHeapBytes = arrayToHeap(element, wasmApi);
    
      /**
       * Process:
       * audio buffer value Float32Array(512)
       * -- fft --> Float32Array(1025)
       * -- filter bank --> Float32Array(40) (output: physical meaning -> energy)
       */
      const energySize = 40;
      const energyData = new Float32Array(energySize);
    
      // malloc memory to memorize memory address of energy data value & Copy to Emscripten heap
      const numBytes = energyData.length * energyData.BYTES_PER_ELEMENT;
      const energyDataPtr = wasmApi._malloc(numBytes);
      energyDataHeapBytes = new Uint8Array(wasmApi.HEAPU8.buffer, energyDataPtr, numBytes);
      energyDataHeapBytes.set(new Uint8Array(energyData.buffer));
    
      // malloc memory to reference to memory address of energy data
      // Create array of pointers that reference each energy data memory address
      // Note the use of Uint32Array. The pointer is limited to 2147483648 bytes
      // or only 2GB of memory :(
      const pointers = new Uint32Array(energySize);
      for (let i = 0; i < pointers.length; i++) {
        pointers[i] = energyDataPtr + i * energyData.BYTES_PER_ELEMENT;
      }
    
      // Allocate bytes needed for the array of pointers
      const nPointerBytes = pointers.length * pointers.BYTES_PER_ELEMENT
      const pointerPtr = wasmApi._malloc(nPointerBytes);
    
      // Copy array of pointers to Emscripten heap
      pointerHeapBytes = new Uint8Array(wasmApi.HEAPU8.buffer, pointerPtr, nPointerBytes);
      pointerHeapBytes.set( new Uint8Array(pointers.buffer) );
    
      const windowSize = 2048; // fft size
      const hopSize = 512;
      wasmApi._aubio_pre_process(inputAudioHeapBytes.byteOffset, element.length, windowSize, hopSize, pointerHeapBytes.byteOffset);
    
      const result = new Float32Array(energyDataHeapBytes.buffer, energyDataHeapBytes.byteOffset, energyData.length);

      return result;
    })
    cb(audioEnergyData);
    
    // Free memory
    freeArray(pointerHeapBytes, wasmApi);
    freeArray(energyDataHeapBytes, wasmApi);
    freeArray(inputAudioHeapBytes, wasmApi);
  })
}

/**
 * Predict function (python version)
|--------------------------------------------------
|def predict(f):
|
|  tmp = []
|  for v in relajet_vec:
|      tmp.append(np.sqrt(np.sum((v - f)**2)))
|
|  tmp = sorted(tmp)[5:-5]
|  d_r = sum(tmp)/len(tmp)
|
|  tmp = []
|  for v in kkbox_vec:
|      tmp.append(np.sqrt(np.sum((v - f)**2)))
|  tmp = sorted(tmp)[5:-5]
|  d_k = sum(tmp)/len(tmp)
|
|  if d_r < d_k and d_r < threshold:
|  #################################
|  ########### RELAJET #############
|  #################################
|      return True
|  #################################
|
|  if d_k < d_r and d_k < threshold:
|  ################################
|  ########### KKBOX ##############
|  ################################
|      return True
|  #################################
|
|  return False
|--------------------------------------------------
*/
function getDistanceBetween(features, targetVectorsArr) {
  const distances = targetVectorsArr.map(targetVectors => {
    const squareSum = features
      .map((feat, idx) => Math.pow(parseFloat(targetVectors[idx]) - feat, 2))
      .reduce((x, y) => x + y)

    return Math.sqrt(squareSum);
  })

  // Pick top 5 lowest one
  const sample = distances.sort().slice(0, 5)

  return sample.reduce((x, y) => x + y) / sample.length
}

self.onmessage = function (e) {
  // console.log('Command & Payload to Worker:', e.data)
  switch (e.data.cmd) {
    case 'loadModels':
      if (cv) {
        cv['onRuntimeInitialized'] = function() {
          isOpencvInitialized = true

          return loadCaffeModel(
            {
              protoPath: './RelaJet-KWS/model/relajet_deploy.prototxt',
              modelPath: './RelaJet-KWS/model/relajet_1.0_cls.caffemodel',
            },
            () => self.postMessage({ msg: 'loadModelsFinished', disabled: false })
          )
        }
      }
      break;
    case 'preprocess': {
      const audioData = e.data.testValue;

      // concatenate audioData to cache
      const newCache = new Float32Array(audioData.length)
      newCache.set(audioData)
      cache = concatenate(Float32Array, cache, newCache)

      // push every cached audio data with 512 size to queue
      while (cache.length > AUBIO_TOTAL_INPUT_SIZE) {
        let chunk = new Float32Array(AUBIO_TOTAL_INPUT_SIZE)
        chunk = cache.slice(0, AUBIO_TOTAL_INPUT_SIZE);
        queue.push(chunk)
        cache = cache.slice(AUBIO_TOTAL_INPUT_SIZE)
      }

      // cache = concatenate(Float32Array, cache, new Float32Array(512 - cache.length).fill(0))
      // queue.push(cache)
      // cache = new Float32Array(0)

      // Preprocess
      while (queue.length >= 32) {
        const inputArr = queue.splice(0, 32);

        aubioProcess(inputArr, (processedArray) => {
          const transposedInputArr = processedArray.reduce((result, curr) => {
            if (result.length === 0) {
              curr.forEach(value => result.push([value]))
              return result
            }
        
            curr.forEach((value, index) => result[index].push(value))
            return result
          }, []);

          // normalized input
          const add = (x, y) => x + y;
          const sum = transposedInputArr.reduce((accu, currArray) => accu + currArray.reduce(add), 0);
          const total = transposedInputArr.reduce((accu, currArray) => accu + currArray.length, 0);
          const mean = sum / total;
          const totalVariance = transposedInputArr.reduce((rslt, currArray) => {
            const variance = currArray.reduce((accu, currentVal) => accu + Math.pow(currentVal - mean, 2), 0);
            return rslt + variance;
          }, 0);
          const variance = totalVariance / total;
          const stdDev = Math.sqrt(variance);

          const normalization = val => (val - mean) / (stdDev + 0.00000001);
          const normalizedInputArr = transposedInputArr.map(arr => arr.map(normalization));
          // console.log(normalizedInputArr)
          // console.log('------------- normalizedInputArr')
          self.postMessage({ msg: 'audioPreprocessFulfilled', payload: normalizedInputArr });
        })
      }
      break;
    }
    case 'inference': {
      if (isOpencvInitialized) {
        /* process array to blob (4d matrix) */
        let mat = cv.matFromArray(40, 32, cv.CV_32FC1, e.data.audioEnergies)
        let blob = cv.blobFromImage(mat, 1, {width: 32, height: 40})

        /* feed blob to dnn-net */
        net.setInput(blob);

        // data32F is wanted value
        let feat = net.forward();

        // post-process -> python: f = f/np.sqrt(np.sum(f**2))
        const averageFeat = Math.sqrt(feat.data32F.reduce((total, curr) => total + Math.pow(curr, 2), 0));
        const normalizedFeat = feat.data32F.map(element => element / averageFeat);

        self.postMessage({ msg: 'inferenceFulfilled', feat: normalizedFeat })
      }

      break;
    }
    case 'predict': {
      self.postMessage({ msg: 'setThresholdFulfilled', payload: threshold })

      const distanceFromRelajet = getDistanceBetween(e.data.payload, relajetCnVec);
      console.log('Distance to Relajet', distanceFromRelajet.toFixed(5))
      console.log('\n')
      const distanceFromKKBox = getDistanceBetween(e.data.payload, kkboxVec);
      console.log('Distance to KKBox', distanceFromKKBox.toFixed(5))
      console.log('\n')
      const distanceFromRelejetEn = getDistanceBetween(e.data.payload, relajetEnVec);
      console.log('Distance to RelejetEn', distanceFromRelejetEn.toFixed(5))
      console.log('=============')

      if (
        distanceFromRelajet < distanceFromKKBox &&
        distanceFromRelajet < distanceFromRelejetEn &&
        distanceFromRelajet < threshold
      ) {
        console.log(`
        #################################
        ########### RELAJET #############
        #################################
        `);
        return self.postMessage({ msg: 'predictFulfilled', predicate: 'relajet' });
      }

      if (
        distanceFromRelejetEn < distanceFromRelajet &&
        distanceFromRelejetEn < distanceFromKKBox &&
        distanceFromRelejetEn < threshold) {
        console.log(`
        #################################
        ########## RELAJET EN ###########
        #################################
        `);
        return self.postMessage({ msg: 'predictFulfilled', predicate: 'relajet-en' });
      }

      if (
        distanceFromKKBox < distanceFromRelajet &&
        distanceFromKKBox < distanceFromRelejetEn &&
        distanceFromKKBox < threshold
      ) {
        console.log(`
        #################################
        ########### KKBOX #############
        #################################
        `);
        return self.postMessage({ msg: 'predictFulfilled', predicate: 'kkbox' });
      }

      return self.postMessage({ msg: 'predictFulfilled', predicate: '' });
    }
    case 'setThreshold':
      threshold = e.data.payload
      self.postMessage({ msg: 'setThresholdFulfilled', payload: threshold })
      break;
    default:
      break;
  }
}

self.onerror = function (e) {
	console.log(e);
}
