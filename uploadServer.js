// Requirements: npm i formidable
const FORMIDABLE = require('formidable');
// Settings:
const HTTP_PORT = 8080;
const DW_PATH = './files/';
const TMP_PATH = './tmp/';
// 1024 * 1024 * 1024 = 1GB
const MAX_SIZE = 1 * 1024 * 1024 * 1024;


const HTTP = require('http');
const QS = require('querystring');
const FS = require('fs');
const PATH = require('path');
const MIME = new Map();
MIME.set('.mp4', 'video/mp4');

const dwPath = PATH.resolve(__dirname, DW_PATH);
if (!FS.existsSync(dwPath)) FS.mkdirSync(dwPath);
const tmpPath = PATH.resolve(__dirname, TMP_PATH);
if (!FS.existsSync(tmpPath)) FS.mkdirSync(tmpPath);

const server = HTTP.createServer((req, res) => {
  if (req.url === '/fileupload' && req.method === 'POST') {
    upload(req, res);
  } else if (req.url === '/' && req.method === 'GET') {
    home(req, res);
  } else if (req.url.startsWith('/get/') && req.method === 'GET') {
    download(req, res);
  } else {
    sendHome(res);
  }
}).listen(HTTP_PORT, () => {
  const { address, port } = server.address();
  console.log(`/**********************\n * now live @ ${address}:${port} *\n **********************/`);
});

const sendHome = res => {
  res.writeHead(302, { Location: '/' });
  res.end();
};
const upload = (req, res) => {
  console.log('fileupload');
  const form = new FORMIDABLE.IncomingForm();
  form.multiples = true;
  form.uploadDir = tmpPath;
  form.maxFileSize = MAX_SIZE;
  form.maxFieldsSize = MAX_SIZE;
  form.parse(req, (err, fields, files) => {
    if (err) throw err;
    const uploadedNames = [];
    for (const file of files.filetoupload) {
      const oldpath = file.path;
      let newpath = PATH.resolve(dwPath, file.name);
      // Check uniqueness of new path
      const dirFiles = FS.readdirSync(PATH.dirname(newpath));
      while (dirFiles.includes(PATH.basename(newpath))) {
        const parts = PATH.parse(newpath);
        let index = parts.name.match(/\(([0-9]+)\)$/);
        let indexedName;
        if (!index) {
          indexedName = parts.name += '(2)';
        } else {
          const cleanName = parts.name.substr(0, parts.name.length - index[0].length);
          indexedName = `${cleanName}(${Number(index[1]) + 1})`;
        }
        newpath = `${parts.dir}${PATH.sep}${indexedName}${parts.ext}`;
      }
      // Security check
      if (!newpath.startsWith(dwPath)) return sendHome(res);
      // Rename
      FS.renameSync(oldpath, newpath);
      uploadedNames.push(newpath);
    }
    let resp_strg = '';
    resp_strg += '<div>File uploaded and moved!</div>';
    resp_strg += '<a href="/">return home</a>';
    resp_strg += '<div><table>';
    resp_strg += '<tr><th>Names on share</th></tr>';
    for (const file of uploadedNames) {
      resp_strg += `<tr><td>${PATH.relative(dwPath, file)}</td></tr>`;
    }
    resp_strg += '</table></div>';
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Length': Buffer.byteLength(resp_strg),
    });
    return res.end(resp_strg);
  });
};
const download = (req, res) => {
  console.log('download');
  const file = PATH.resolve(dwPath, QS.unescape(req.url.substr(5)));
  let stat;
  try {
    stat = FS.statSync(file);
  } catch (e) {
    console.log('invalid file', { file, part: req.url.substr(5) });
    return sendHome(res);
  }
  if (!stat.isFile()) return sendHome(res);
  if (!file.startsWith(dwPath)) return sendHome(res);
  const mime = MIME.get(PATH.basename(file));

  let startChunk = 0;
  let endChunk = stat.size;
  let chunkSize = stat.size;
  if (req.headers.range) {
    const parts = req.headers.range.replace(/bytes=/, '').trim().split('-');
    startChunk = parseInt(parts[0], 10);
    endChunk = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    chunkSize = (endChunk - startChunk) + 1;
  }
  res.writeHead(200, {
    'Content-Type': mime || 'application/octet-stream',
    'Content-Length': chunkSize,
    'Content-Range': `bytes ${startChunk}-${endChunk}/${stat.size}`,
    'Accept-Ranges': 'bytes',
  });
  FS.createReadStream(file, { start: startChunk, end: endChunk }).pipe(res);
  return null;
};
const home = (req, res) => {
  console.log('home');
  let resp_strg = '';
  resp_strg += '<div id="fileupload">Upload:<form action="fileupload" method="post" enctype="multipart/form-data">';
  resp_strg += '<input type="file" name="filetoupload" multiple><br>';
  resp_strg += '<input type="submit">';
  resp_strg += '</form></div>';

  resp_strg += '<div id="filedownload">Files:<table>';
  resp_strg += '<tr><th>Name</th><th>Size</th><th>added</th></tr>';
  for (const file of fetchFiles(dwPath, './')) {
    const path = `${PATH.sep}get${PATH.sep}${file.loc.relative}`;
    resp_strg += `<tr onclick='window.location = ${JSON.stringify(path)}'>`;
    resp_strg += `<td>${file.loc.relative}</td>`;
    resp_strg += `<td>${(file.size / 1024 / 1024).toFixed(2)} MB</td>`;
    resp_strg += `<td>${file.birthtime.toISOString()}</td>`;
    resp_strg += '</tr>';
  }
  resp_strg += '</table>';

  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Length': Buffer.byteLength(resp_strg),
  });
  return res.end(resp_strg);
};

const fetchFiles = (baseDir, dir) => {
  const resp = [];
  for (const f of FS.readdirSync(PATH.resolve(baseDir, dir))) {
    const file = PATH.resolve(baseDir, dir, f);
    const stat = FS.statSync(file);
    stat.loc = { absolut: file, relative: PATH.relative(baseDir, file) };
    if (stat.isDirectory()) {
      resp.push(...fetchFiles(baseDir, stat.loc.relative));
    } else if (stat.isFile()) {
      resp.push(stat);
    }
  }
  return resp;
};
