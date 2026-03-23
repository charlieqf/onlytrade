const http = require('http');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 18080;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

http.createServer(function (request, response) {
  let filePath = (request.url === '/' ? '/index.html' : request.url).split('?')[0];
  // Strip /onlytrade prefix if it reaches here
  if (filePath.startsWith('/onlytrade')) {
    filePath = filePath.substring('/onlytrade'.length);
    if (filePath === '') filePath = '/index.html';
  }

  let extname = String(path.extname(filePath)).toLowerCase();
  let contentType = mimeTypes[extname] || 'application/octet-stream';

  const absolutePath = path.join(__dirname, filePath);

  fs.readFile(absolutePath, function(error, content) {
    if (error) {
      if(error.code == 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), function(error, content) {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end(content, 'utf-8');
        });
      } else {
        response.writeHead(500);
        response.end('Sorry, check with the site admin for error: '+error.code+' ..\\n');
      }
    } else {
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(content, 'utf-8');
    }
  });
}).listen(port);
console.log("Server running at http://localhost:" + port);
