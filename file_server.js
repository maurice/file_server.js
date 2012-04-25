/**
 * A simple node.js static file server with no external dependencies
 *
 * Features:
 * 
 *   Directory listing
 *   Navigation outside of root not permitted
 *   Real filesystem root dir is not exposed to clients
 *   Command line options for port, root (see "options" below)
 *   Files are streamed to client (rather than read completely into memory first)
 */

// Supported command line options
var options = new Options({
    help: { switches: ['--help', '-h'], description: "Show help" },
    port: { switches: ['--port', '-p'], description: "Port to listen on", default: 8888 },
    root: { switches: ['--root', '-r'], description: "Root dir to serve, defaults to CWD", default: process.cwd() }
});

// todo if-modified-since -> 304 support, plus expiry/cache headers
// todo logfile for service usage

var http = require("http"),
    url = require("url"),
    path = require("path"),
    fs = require("fs"),
    util = require("util");

// Validate command line args
var args = options.parse(process.argv);

if (args.help) {
  console.error("Usage: node file_server.js [options]\nOptions:\n" + options.describe());
  process.exit(0);
}
var port = args.port;
if (isNaN(port)) {
  console.error("Bad port: %s", port);
  process.exit(0);
}
var root = args.root;
if (!path.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error("Bad root directory: %s", root);
  process.exit(0);
}

var serverjsFilename = process.argv[1];
var cssUri = path.basename(serverjsFilename) + ".css";

// Start server
http.createServer(requestHandler).listen(parseInt(port, 10));

console.log("Listening on port %d, root %s", port, root);

// Private
function requestHandler(request, response) {

  var uri = url.parse(request.url).pathname
    , filename = path.join(root, uri);

  if (uri == "/" + cssUri) {
    cssHandler(response);
    return;
  }

  path.exists(filename, function(exists) {
    if (!exists) {
      response.writeHead(404, {"Content-Type": "text/plain"});
      response.write("404 Not Found\n");
      response.end();
      return;
    }

    if (fs.statSync(filename).isDirectory()) {
      directoryHandler(response, uri, filename);
      return;
    };

    // Stream file to client
    var s = fs.createReadStream(filename);
    var startedStreaming = false;
    s.on("open", function(fd) {
      s.pipe(response);
      startedStreaming = true;
    });
    s.on("error", function(err) {
      console.error("Error reading stream for file %s: %s", filename, err);
      if (!startedStreaming)
      {
        internalErrorHandler(response, err);
      }
    });
  });
}

function directoryHandler(response, uri, filename) {

  function dirListingRow(filename, stat) {
    return util.format(
      '<tr><td><a href="%s">%s</a></td><td>%s</td><td>%s</td><td>%s</td></tr>',
      path.join(uri, filename), 
      filename + (stat && stat.isDirectory() ? "/" : ""),
      (stat && !stat.isDirectory() ? stat.size : "&lt;Directory&gt;"),
      stat ? util.inspect(new Date(stat.mtime)) : '',
      stat ? util.inspect(new Date(stat.ctime)) : ''
    );
  }
  
  function writeFiles(response, files, stats) {
    for (var j = 0; j < files.length; j++) {
      response.write(dirListingRow(files[j], stats[files[j]]));
    }
    response.write('</table>');
    response.end();
  }

  fs.readdir(filename, function(err, files) {
    if (err) {
      internalErrorHandler(response, err);
      return;
    }

    response.writeHead(200, {"Content-Type": "text/html"});
    response.write(util.format("<h1>%s</h1>", uri));
    response.write(util.format('<link rel="stylesheet" href="/%s">', cssUri));
    response.write('<table width="100%" cellpadding="0" cellspacing="0" border="0">');
    response.write('<tr><th>Name</th><th></th><th>Created</th><th>Modified</th></tr>');
    if (uri != '/') {
      response.write(dirListingRow('..'));
    }
    var count = 0;
    var stats = {};
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      fs.stat(path.join(filename, file), function(file, err, stat) {
        if (err) {
          internalErrorHandler(response, err);
          return;
        }
        stats[file] = stat;
        if (++count == files.length) {
          writeFiles(response, files, stats);
        }
      }.bind(null, file));
    }
  });
}

function cssHandler(response) {
  fs.readFile(serverjsFilename, "utf8", function(err, file) {
    if (err) {
      console.error("Error reading file for CSS: %s", err);
      internalErrorHandler(response, err);
      return;
    }

    var offset = file.indexOf('/' + '* CSS') + 6; // prevent finding *this* occurance
    file = file.substr(offset, file.indexOf('*/', offset) - offset);
    response.writeHead(200, {"Content-Type": "text/css"});
    response.write(file);
    response.end();
  });
}

function internalErrorHandler(response, err) {
  response.writeHead(500, {"Content-Type": "text/plain"});
  response.write(err + "\n");
  response.end();
}

/**
 * Helper to parse command line args
 */
function Options(config) {
  this._config = config;

  this.parse = function(args) {
    var result = {};
    for (var name in this._config) {
      var option = this._config[name];
      for (var i = 0; i < option.switches.length; i++) {
        var sw = option.switches[i];
        var index = args.indexOf(sw);
        if (index != -1) {
          if (option.default) { // ie, value should follow
            result[name] = args[index + 1].charAt(0) != '-' ? args[index + 1] : null;
          } else {
            result[name] = true;
          }
        } else if (result[name] === undefined && option.default) {
          result[name] = option.default;
        }
      }
    }
    return result;
  };

  this.describe = function() {
    var s = "";
    for (var name in this._config) {
      var option = this._config[name];
      var sw = option.switches.join(", ");
      var pad = Math.max(12 - sw.length, 0);
      while (pad--) s += ' ';
      s += sw;
      pad = 10;
      while (pad--) s += ' ';
      s += option.description;
      if (option.default) {
        pad = Math.max(40 - option.description.length, 0);
        while (pad--) s += ' ';
        s += '(Optional, defaults to ' + option.default + ')';
      }
      s += "\n";
    }
    return s;
  };

}

/* CSS

* {
    font-family: Monaco, ProFont, "Bitstream Vera Sans Mono", "American Typewriter", "Andale Mono", monospace;
}
h1 {
    font-size: 1.4em;
}
p, td {
    font-size: 0.9em;
}
a:link, a:visited {
    color: blue;
    text-decoration: none;
}
a:hover, a:active {
    color: blue;
    text-decoration: underline;
}
.directory {
  font-weight: bold;
}
tr {
    text-align: left;
}
th {
    font-size: 0.9em;
    border-bottom: 1px solid #E0E0E0;
}
td {
    padding-right: 8;
}

*/
