const fs = require('fs')
const path = require('path')
const baseFolderPath = './RelaJet-KWS/'

const capitalize = str => str.slice(0, 1).toUpperCase() + str.slice(1);

const txtToJs = (txtListFile) => {
  const arr = []
  fs.readFile(`./RelaJet-KWS/featTxt/${txtListFile}`, 'utf8', (err, txtPaths) => {
    txtPaths.split('\n').filter(el => el !== '').forEach(content => {
      const filePath = baseFolderPath + content

      fs.readFile(filePath, 'utf8', (err, data) => {
        arr.push(data.split('\n').filter(el => el !== ''))
        const folderName = path.parse(txtListFile).name
        const functionName = folderName.split('-').map(word => capitalize(word)).join('')
        const content = `
          function get${functionName}() {
            return ${JSON.stringify(arr)}
          }
        `

        fs.writeFile(`./${functionName.slice(0, 1).toLowerCase()}${functionName.slice(1)}.js`, content, 'utf8', (err) => {
          if (err) console.log(err);
        })
      })
    })
  })
}

  txtToJs('relajet.txt')
  txtToJs('relajet-en.txt')
  txtToJs('kkbox.txt')
