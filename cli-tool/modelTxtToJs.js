var program = require('commander');
var fs = require('fs')
var path = require('path')

const capitalize = str => str.slice(0, 1).toUpperCase() + str.slice(1);

const txtToJs = (indexFilePath) => {
  const arr = []
  fs.readFile(indexFilePath, 'utf8', (err, txtPaths) => {
    txtPaths.split('\n').filter(string => string !== '').forEach(txtPath => {
      const filePath = path.join(
        path.parse(indexFilePath).dir, // dir
        path.parse(txtPath).dir.split(path.sep).pop(), // sub dir
        path.parse(txtPath).base // filename
      )

      fs.readFile(filePath, 'utf8', (err, data) => {
        arr.push(data.split('\n').filter(string => string !== ''))
        const folderName = path.parse(indexFilePath).name
        const functionName = folderName.split('-').map(word => capitalize(word)).join('')
        
        const content = `
          function get${functionName}() {
            return ${JSON.stringify(arr)}
          }
        `

        fs.writeFile(path.join(path.parse(program.outFile).dir, `${path.parse(program.outFile).name}.js`), content, 'utf8', (err) => {
          if (err) console.error(err);
          if (path.parse(program.outFile).ext !== '.js') {
            console.warn(`
            ##############################
            #   file must be .js         #
            #   auto change ext to .js   #
            ##############################
            `)
          }
        })
      })
    })
  })
  console.log('Finished.')
}

program
  .version('0.1.0')
  .usage('[-f] <path to file> [-o] <output file path>')
  .option('-f, --file <file path>', 'read model txt index file')
  .option('-o, --out-file <path>', 'output file')
  .parse(process.argv);

if (!program.file || !program.outFile) {
  console.log(`
  Lack of arguments, want to see help?
  -> node txtToJs.js -h

  Read model index file under RelaJet-KWS/featTxt (Ex. relajet.txt, relajet-en.txt, kkbox.txt)

  Example: node modelTxtToJs.js -f path/to/RelaJet-KWS/featTxt/relajet-en.txt -o relajetEn.js
  `)
  return;
}

txtToJs(program.file)
