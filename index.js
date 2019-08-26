
const fs = require('fs')
const url = require('url')
const path = require('path')

const get = src => new Promise((resolve, reject) => {
  const http = require('http')
  http
    .get(src, response => {
      const { statusCode } = response

      if (statusCode !== 200 && statusCode !== 302) {
        return reject(
          new Error('Request Failed.\n' + `Status Code: ${statusCode}`)
        )
      }

      response.setEncoding('utf8')

      let rawData = ''
      response.on('data', chunk => {
        rawData += chunk
      })
      response.on('end', () => {
        if (statusCode === 302) {
          let httpPos = rawData.indexOf(' http')
          let redirect = rawData.substr(httpPos + 1)
          return resolve(redirect)
        }
        resolve(rawData)
      })
    })
    .on('error', reject)
})

const post = src => new Promise((resolve, reject) => {
  const https = require('https')

  const parts = url.parse(src, true)

  const data = JSON.stringify({})

  const options = {
    hostname: parts.host,
    port: 443,
    path: parts.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }

  const req = https.request(options, response => {
    const chunks = []
    response.on('data', data => chunks.push(data))
    response.on('end', () => {
      let body = Buffer.concat(chunks).toString()
      try {
        body = JSON.parse(body)
      } catch (error) {
        console.log(error)
      }

      resolve(body)
    })
  })

  req.on('error', reject)
  req.write(data)
  req.end()
})

/**
 * Get anime name and create directory
 * @param {String!} url
 * @returns {String}
 */
const getAnimeName = src => {
  let lastSlash = src.split('/').pop()
  let endPos = lastSlash.indexOf('-tap-')
  let animeName = lastSlash.substr(0, endPos)
  let dirs = [
    `./logs/${animeName}`,
    `./output/${animeName}`
  ]

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
    }
  }

  return animeName
}

/**
 * Get list all chapter
 * @param {String!} src
 * @returns {Promise<Array<String>>}
 */
const getAllChapUrl = async src => {
  let data = await get(src)
  let content = data.replace(/\>\</gm, '>\n<')
  let chapterRegex = /\<a\ href\=\"(.*)\"\ class\=\"(active|)\"/gm
  return content
    .match(chapterRegex)
    .map(aTag => aTag.replace(chapterRegex, '$1'))
}

const loadSourceHTML = async src => {
  let animeName = global.animeName
  let lastSlash = src.split('/').pop()
  let logFile = `./logs/${animeName}/${lastSlash}`
  if (fs.existsSync(logFile)) {
    return fs.readFileSync(logFile)
  }

  // get html source
  let data = await get(src)
  let content = data.replace(/\>\</gm, '>\n<')

  // file - logger
  fs.writeFileSync(logFile, content)

  return content
}

const getIframeSrc = src => {
  let animeName = global.animeName
  let lastSlash = src.split('/').pop()
  let content = fs.readFileSync(`./logs/${animeName}/${lastSlash}`, { encoding: 'utf8' })
  let iframeSrcRegex = /frameborder\=\"0\"\ src\=\"(.*)\"\ allowfullscreen\>/m
  let result = content
    .match(iframeSrcRegex)[0]
    .replace(iframeSrcRegex, '$1')
  return result
}

const loadVideoMeta = async src => {
  let animeName = global.animeName
  let parts = url.parse(src, true)
  let key = parts.query.key
  let postUrl = parts.protocol + '//' + parts.host + '/initPlayer/' + key
  let redirectPath = `./logs/${animeName}/${key}.html`
  let redirect = ''
  if (fs.existsSync(redirectPath)) {
    redirect = fs.readFileSync(redirectPath, { encoding: 'utf8' })
  } else {
    let response = await post(postUrl)
    redirect = await get(response.data)
    fs.writeFileSync(redirectPath, redirect)
  }

  let videoUrl = url.parse(redirect, true)
  let id = videoUrl.query.id
  let videoMetaUrl = videoUrl.protocol + '//' + videoUrl.host + '/hls/' + id + '/' + id + '.playlist.m3u8'
  return videoMetaUrl
}

const download = (src, chapter) => {
  let animeName = global.animeName
  let animeOutputPath = path.join(__dirname, 'output', animeName)
  if (!fs.existsSync(animeOutputPath)) {
    fs.mkdirSync(animeOutputPath)
  }

  let fileName = `${chapter}.mp4`
  let mp4Path = path.join(animeOutputPath, fileName)
  if (fs.existsSync(mp4Path)) {
    return console.log(`Already exists: ${fileName}`)
  }

  const { spawn } = require('child_process')
  const cmd = [
    `-i`,
    `${src}`,
    `-c`,
    `copy`,
    `-bsf:a`,
    `aac_adtstoasc`,
    `${mp4Path}`
  ]

  console.log(cmd)

  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${fileName}`)

    const ffmpeg = spawn('ffmpeg', cmd)
    ffmpeg.stdout.on('data', data => {
      console.log(`stdout: ${data}`)
    })
    
    ffmpeg.stderr.on('data', data => {
      console.log(`stderr: ${data}`)
    })
    
    ffmpeg.on('close', code => {
      console.log(`child process exited with code ${code}`)
      resolve(code)
    })
  })
}

const ensureReady = () => {
  let dirs = [
    `./logs`,
    `./output`
  ]

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
    }
  }
}

;(async () => {
  try {
    ensureReady()

    let url = 'http://animehay.tv/phim/kimetsu-no-yaiba-tap-21-e90688.html' // change this line to download another anime

    global.animeName = getAnimeName(url)
    let chapters = await getAllChapUrl(url)
    for (let chapter of chapters) {
      await loadSourceHTML(chapter)
    }

    let iframeSrcs = chapters.map(getIframeSrc)
    for (let index in iframeSrcs) {
      console.log('============================================================================')
      let chapter = iframeSrcs[index]
      let chapterName = chapters[index].split('/').pop().replace(/\.[a-zA-Z]*$/, '')

      let videoMetaUrl = await loadVideoMeta(chapter)
      await download(videoMetaUrl, chapterName)
    }

    console.log('Downloaded successfully!')
  } catch (error) {
    console.error(error)
  }
})()
